import pg from 'pg'
import type { PostgresConfig, EmbeddingConfig } from '../entities/UserConfig'
import { EmbeddingService } from './EmbeddingService'

/**
 * 记忆向量库（pgvector）：
 * - 复用配置中心的 PostgreSQL 连接（与 HITL checkpointer 同库），
 *   记忆表 node_memory 按用户 + kind（user/assistant）隔离
 * - 表结构（首次访问时自动建）：
 *   id serial PK / user_id int / kind varchar(16) / content text /
 *   category varchar(32) / confidence numeric(3,2) / embedding vector(N) /
 *   source_session int / created_at / updated_at
 * - 相关性检索：1 - cosine 距离，取 top-k
 * - 写入/修改时实时向量化（EmbeddingService）
 */
export type MemoryKind = 'user' | 'assistant'

export interface MemoryRow {
  id: number
  userId: number
  kind: MemoryKind
  content: string
  /** 知识类别：fact / behavior / preference / experience 等（模型生成） */
  category?: string | null
  /** 可信度 0-1（模型生成） */
  confidence?: number | null
  sourceSession?: number | null
  createdAt: string
  updatedAt: string
}

export interface UpsertMemoryInput {
  content: string
  category?: string
  confidence?: number
  sourceSession?: number | null
}

const pools = new Map<number, { pool: pg.Pool; signature: string }>()

function connConfig(c: PostgresConfig): pg.PoolConfig {
  return {
    host: c.host,
    port: c.port || 5432,
    user: c.user,
    password: c.password,
    database: c.database,
    max: 4,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 8_000
  }
}

function signature(c: PostgresConfig): string {
  return `${c.host}|${c.port}|${c.user}|${c.password}|${c.database}`
}

/** 拿到用户的 pg 连接池（不建表；建表在 ensureTable） */
export async function getPool(userId: number, pgc: PostgresConfig): Promise<pg.Pool> {
  const sig = signature(pgc)
  const existing = pools.get(userId)
  if (existing && existing.signature === sig) return existing.pool
  if (existing) {
    pools.delete(userId)
    await existing.pool.end().catch(() => {})
  }
  const pool = new pg.Pool(connConfig(pgc))
  pools.set(userId, { pool, signature: sig })
  return pool
}

/** vector 扩展是否已安装（已装时普通账号也能建 vector 列） */
async function hasVectorExtension(pool: pg.Pool): Promise<boolean> {
  try {
    const { rows } = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`)
    return rows.length > 0
  } catch {
    return false
  }
}

/** 维度变更检测：建表用的维度与配置不一致时清库重建 */
async function ensureTable(pool: pg.Pool, dims: number): Promise<void> {
  // 普通账号无权 CREATE EXTENSION：扩展已存在时跳过安装继续；
  // 真缺失时抛出带处理指引的错误（pgvector 未安装或权限不足）
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`)
  } catch (e: any) {
    const installed = await hasVectorExtension(pool)
    if (!installed) {
      throw new Error(
        e?.code === '42501'
          ? 'PostgreSQL 账号无权安装 pgvector 扩展，且库中尚未安装。请用超级用户执行：CREATE EXTENSION vector；或改用有权限的账号'
          : 'PostgreSQL 缺少 pgvector 扩展，请先安装 pgvector 并由超级用户执行：CREATE EXTENSION vector'
      )
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS node_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      kind VARCHAR(16) NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      category VARCHAR(32),
      confidence NUMERIC(3,2),
      embedding VECTOR(${dims}),
      source_session INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_node_memory_user_kind ON node_memory (user_id, kind)`)
  // 现表维度与配置不符 → 清空重建（改向量模型属破坏性变更）
  const { rows } = await pool.query(
    `SELECT atttypmod AS dims FROM pg_attribute
     WHERE attrelid = 'node_memory'::regclass AND attname = 'embedding'`
  )
  const current = Number(rows[0]?.dims || 0)
  if (current && current !== dims) {
    await pool.query(`DROP TABLE node_memory`)
    await ensureTable(pool, dims)
  }
}

export interface MemoryStoreDeps {
  userId: number
  pg: PostgresConfig
  embedding: EmbeddingConfig
}

/** 完整可用：pg 与向量模型均已配置 */
export function isMemoryReady(pg?: PostgresConfig | null, emb?: EmbeddingConfig | null): boolean {
  return Boolean(pg?.host && pg?.user && pg?.password && pg?.database && EmbeddingService.isReady(emb))
}

function toRow(r: any): MemoryRow {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    kind: r.kind,
    content: r.content,
    category: r.category ?? null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    sourceSession: r.source_session != null ? Number(r.source_session) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

/**
 * 时间衰减系数：越久远的记忆可靠性越低。
 * 指数衰减（半衰期 halfLifeDays，默认 30 天）：
 *   factor = 0.5 ^ (ageDays / halfLife)
 * - 7 天内 ≈ 0.85+（近期记忆几乎不影响）
 * - 30 天 = 0.5
 * - 90 天 ≈ 0.13、180 天 ≈ 0.02（久远记忆可信度大幅折减）
 */
export function timeDecayFactor(updatedAt: string | Date, halfLifeDays = 30): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1
  const ageDays = ageMs / (24 * 60 * 60 * 1000)
  return Math.pow(0.5, ageDays / halfLifeDays)
}

/** 记忆年龄描述（注入提示词用） */
export function memoryAgeLabel(updatedAt: string | Date): string {
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  if (ageMs < 0) return '刚刚'
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/**
 * 相关性检索：query 向量化后取 cosine 最近邻，按「相关性 × 时间衰减 × 可信度」重排取 top-k。
 * - score：原始向量相关性（cosine 相似度 0-1）
 * - decay：时间衰减系数（0-1，越久远越低，半衰期 30 天）
 * - finalScore：score × decay × confidence 综合可靠度
 * kind 缺省同时检索用户记忆与小助理记忆。
 */
export async function searchMemories(
  deps: MemoryStoreDeps,
  query: string,
  topK = 8,
  kind?: MemoryKind
): Promise<(MemoryRow & { score: number; decay: number; finalScore: number; ageLabel: string })[]> {
  const dims = deps.embedding.dimensions || 1024
  const [vec] = await EmbeddingService.embed([query], deps.embedding, deps.userId, dims)
  const pool = await getPool(deps.userId, deps.pg)
  await ensureTable(pool, dims)
  const kinds = kind ? [kind] : ['user', 'assistant']
  // 取 3 倍候选再重排（久但强相关的记忆能进来，近期强相关的排前面）
  const { rows } = await pool.query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS score
     FROM node_memory
     WHERE user_id = $2 AND kind = ANY($3)
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [`[${vec.join(',')}]`, deps.userId, kinds, topK * 3]
  )
  return rows
    .map((r: any) => {
      const row = toRow(r)
      const decay = timeDecayFactor(row.updatedAt)
      const conf = row.confidence ?? 0.8
      return {
        ...row,
        score: Number(r.score),
        decay,
        finalScore: Number(r.score) * decay * conf,
        ageLabel: memoryAgeLabel(row.updatedAt)
      }
    })
    .sort((a: any, b: any) => b.finalScore - a.finalScore)
    .slice(0, topK)
}

/** 新增记忆（实时向量化） */
export async function insertMemory(deps: MemoryStoreDeps, kind: MemoryKind, input: UpsertMemoryInput): Promise<MemoryRow> {
  const dims = deps.embedding.dimensions || 1024
  const [vec] = await EmbeddingService.embed([input.content], deps.embedding, deps.userId, dims)
  const pool = await getPool(deps.userId, deps.pg)
  await ensureTable(pool, dims)
  const { rows } = await pool.query(
    `INSERT INTO node_memory (user_id, kind, content, category, confidence, embedding, source_session)
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
     RETURNING *`,
    [deps.userId, kind, input.content, input.category ?? null, input.confidence ?? null, `[${vec.join(',')}]`, input.sourceSession ?? null]
  )
  return toRow(rows[0])
}

/** 修改记忆内容/类别/可信度（重新向量化） */
export async function updateMemory(
  deps: MemoryStoreDeps,
  kind: MemoryKind,
  id: number,
  input: Partial<UpsertMemoryInput>
): Promise<MemoryRow | null> {
  const dims = deps.embedding.dimensions || 1024
  let vecStr: string | null = null
  if (typeof input.content === 'string' && input.content.trim()) {
    const [vec] = await EmbeddingService.embed([input.content], deps.embedding, deps.userId, dims)
    vecStr = `[${vec.join(',')}]`
  }
  const pool = await getPool(deps.userId, deps.pg)
  await ensureTable(pool, dims)
  const { rows } = await pool.query(
    `UPDATE node_memory SET
       content = COALESCE($3, content),
       category = COALESCE($4, category),
       confidence = COALESCE($5, confidence),
       embedding = COALESCE($6::vector, embedding),
       updated_at = now()
     WHERE id = $7 AND user_id = $1 AND kind = $2
     RETURNING *`,
    [deps.userId, kind, input.content ?? null, input.category ?? null, input.confidence ?? null, vecStr, id]
  )
  return rows.length ? toRow(rows[0]) : null
}

/** 删除记忆 */
export async function deleteMemory(deps: MemoryStoreDeps, kind: MemoryKind, id: number): Promise<boolean> {
  const dims = deps.embedding.dimensions || 1024
  const pool = await getPool(deps.userId, deps.pg)
  await ensureTable(pool, dims)
  const { rowCount } = await pool.query(
    `DELETE FROM node_memory WHERE id = $3 AND user_id = $1 AND kind = $2`,
    [deps.userId, kind, id]
  )
  return (rowCount || 0) > 0
}

/** 列表查询（时间倒序，支持关键词过滤） */
export async function listMemories(
  deps: MemoryStoreDeps,
  kind: MemoryKind,
  keyword?: string,
  limit = 200
): Promise<MemoryRow[]> {
  const dims = deps.embedding.dimensions || 1024
  const pool = await getPool(deps.userId, deps.pg)
  await ensureTable(pool, dims)
  const { rows } = await pool.query(
    `SELECT * FROM node_memory
     WHERE user_id = $1 AND kind = $2 AND ($3 = '' OR content ILIKE '%' || $3 || '%')
     ORDER BY updated_at DESC
     LIMIT $4`,
    [deps.userId, kind, keyword?.trim() || '', limit]
  )
  return rows.map(toRow)
}
