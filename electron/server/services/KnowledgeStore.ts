import pg from 'pg'
import type { PostgresConfig, EmbeddingConfig } from '../entities/UserConfig'
import { EmbeddingService } from './EmbeddingService'
import { isMemoryReady, getPool, type MemoryStoreDeps } from './MemoryStore'

/**
 * 知识库存储（pgvector，与记忆库同库不同表）：
 * - node_knowledge_doc：知识条目（来源文件 / 小助理对话），含 md5 去重、状态与进度
 * - node_knowledge_chunk：切片，含原文与向量，cosine 检索
 * - 复用 MemoryStore 的连接池与就绪判定（同一 pg 配置）
 */
export interface KnowledgeDocRow {
  id: number
  userId: number
  /** file = 用户上传文件；chat = 小助理对话沉淀 */
  source: 'file' | 'chat'
  title: string
  /** 文件名（source=file）；chat 来源为空 */
  fileName?: string | null
  /** 工作目录内相对路径（source=file） */
  relPath?: string | null
  /** 文件 md5（去重依据；chat 来源为空） */
  md5?: string | null
  /** 文件大小（字节） */
  size?: number | null
  /** pending / parsing / chunking / embedding / done / error */
  status: string
  /** 状态详情（进度文本/错误信息） */
  statusDetail?: string | null
  /** 切片数 */
  chunkCount: number
  /** 原始文本长度（字符） */
  charCount: number
  sourceSession?: number | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunkRow {
  id: number
  docId: number
  userId: number
  /** 切片序号（0 起） */
  seq: number
  content: string
  charCount: number
  createdAt: string
}

export interface KnowledgeDocDeps extends MemoryStoreDeps {}

/** doc 行 → DTO */
function toDoc(r: any): KnowledgeDocRow {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    source: r.source,
    title: r.title,
    fileName: r.fileName ?? r.file_name ?? null,
    relPath: r.rel_path ?? null,
    md5: r.md5 ?? null,
    size: r.size != null ? Number(r.size) : null,
    status: r.status,
    statusDetail: r.status_detail ?? null,
    chunkCount: Number(r.chunk_count || 0),
    charCount: Number(r.char_count || 0),
    sourceSession: r.source_session != null ? Number(r.source_session) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

/** 建表（幂等；向量维度与配置不符时清表重建） */
export async function ensureKnowledgeTables(pool: pg.Pool, dims: number): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS node_knowledge_doc (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'file',
      title VARCHAR(256) NOT NULL,
      file_name VARCHAR(512),
      rel_path VARCHAR(1024),
      md5 VARCHAR(64),
      size BIGINT,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      status_detail TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      char_count INTEGER NOT NULL DEFAULT 0,
      source_session INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kdoc_user ON node_knowledge_doc (user_id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS node_knowledge_chunk (
      id SERIAL PRIMARY KEY,
      doc_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      char_count INTEGER NOT NULL DEFAULT 0,
      embedding VECTOR(${dims}),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kchunk_doc ON node_knowledge_chunk (doc_id)`)
  // 向量维度变更检测：不符清表重建（切片向量可由源文件/原文重算）
  const { rows } = await pool.query(
    `SELECT atttypmod AS dims FROM pg_attribute
     WHERE attrelid = 'node_knowledge_chunk'::regclass AND attname = 'embedding'`
  )
  const current = Number(rows[0]?.dims || 0)
  if (current && current !== dims) {
    await pool.query(`DROP TABLE node_knowledge_chunk`)
    await ensureKnowledgeTables(pool, dims)
  }
}

/** 复用 MemoryStore 的池（同库同配置） */
async function getPoolFrom(deps: KnowledgeDocDeps): Promise<pg.Pool> {
  return getPool(deps.userId, deps.pg)
}

/** 知识库就绪（pg + 向量模型） */
export function isKnowledgeReady(pg?: PostgresConfig | null, emb?: EmbeddingConfig | null): boolean {
  return isMemoryReady(pg, emb)
}

/** 按 md5 查重（同用户同文件） */
export async function findDocByMd5(deps: KnowledgeDocDeps, md5: string): Promise<KnowledgeDocRow | null> {
  const pool = await getPoolFrom(deps)
  const dims = deps.embedding.dimensions || 1024
  await ensureKnowledgeTables(pool, dims)
  const { rows } = await pool.query(
    `SELECT * FROM node_knowledge_doc WHERE user_id = $1 AND md5 = $2 AND source = 'file' LIMIT 1`,
    [deps.userId, md5]
  )
  return rows.length ? toDoc(rows[0]) : null
}

/** 新建知识条目（上传先落记录，状态 pending） */
export async function createKnowledgeDoc(
  deps: KnowledgeDocDeps,
  input: {
    source: 'file' | 'chat'
    title: string
    fileName?: string
    relPath?: string
    md5?: string
    size?: number
    sourceSession?: number | null
  }
): Promise<KnowledgeDocRow> {
  const pool = await getPoolFrom(deps)
  const dims = deps.embedding.dimensions || 1024
  await ensureKnowledgeTables(pool, dims)
  const { rows } = await pool.query(
    `INSERT INTO node_knowledge_doc (user_id, source, title, file_name, rel_path, md5, size, status, source_session)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
     RETURNING *`,
    [deps.userId, input.source, input.title.slice(0, 250), input.fileName || null, input.relPath || null, input.md5 || null, input.size ?? null, input.sourceSession ?? null]
  )
  return toDoc(rows[0])
}

/** 更新状态/进度 */
export async function updateDocStatus(deps: KnowledgeDocDeps, id: number, status: string, detail?: string | null, extra?: { chunkCount?: number; charCount?: number }): Promise<void> {
  const pool = await getPoolFrom(deps)
  await pool.query(
    `UPDATE node_knowledge_doc SET
       status = $3,
       status_detail = $4,
       chunk_count = COALESCE($5, chunk_count),
       char_count = COALESCE($6, char_count),
       updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [id, deps.userId, status, detail ?? null, extra?.chunkCount ?? null, extra?.charCount ?? null]
  )
}

/** 批量写入切片（含向量化；分批 embed 控制单次请求体积） */
export async function insertChunks(deps: KnowledgeDocDeps, docId: number, contents: string[]): Promise<number> {
  const dims = deps.embedding.dimensions || 1024
  const pool = await getPoolFrom(deps)
  await ensureKnowledgeTables(pool, dims)
  const BATCH = 16
  let inserted = 0
  for (let i = 0; i < contents.length; i += BATCH) {
    const batch = contents.slice(i, i + BATCH)
    const vecs = await EmbeddingService.embed(batch, deps.embedding, deps.userId, dims)
    for (let j = 0; j < batch.length; j++) {
      await pool.query(
        `INSERT INTO node_knowledge_chunk (doc_id, user_id, seq, content, char_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [docId, deps.userId, i + j, batch[j], batch[j].length, `[${vecs[j].join(',')}]`]
      )
      inserted++
    }
  }
  return inserted
}

/** 删除知识条目（连带切片） */
export async function deleteKnowledgeDoc(deps: KnowledgeDocDeps, id: number): Promise<boolean> {
  const pool = await getPoolFrom(deps)
  await pool.query(`DELETE FROM node_knowledge_chunk WHERE doc_id = $1 AND user_id = $2`, [id, deps.userId])
  const { rowCount } = await pool.query(`DELETE FROM node_knowledge_doc WHERE id = $1 AND user_id = $2`, [id, deps.userId])
  return (rowCount || 0) > 0
}

/** 清空某文档旧切片（重试/重建用） */
export async function clearChunks(deps: KnowledgeDocDeps, docId: number): Promise<void> {
  const pool = await getPoolFrom(deps)
  await pool.query(`DELETE FROM node_knowledge_chunk WHERE doc_id = $1 AND user_id = $2`, [docId, deps.userId])
}

/** 更新知识条目标题（知识合成 update 操作后同步新标题） */
export async function updateKnowledgeDocTitle(deps: KnowledgeDocDeps, id: number, title: string): Promise<void> {
  const pool = await getPoolFrom(deps)
  await pool.query(
    `UPDATE node_knowledge_doc SET title = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [id, deps.userId, title.slice(0, 250)]
  )
}

/** 取某知识条目的切片内容（拼接；知识合成检索的现有知识上下文用） */
export async function getDocContentForMerge(deps: KnowledgeDocDeps, id: number, maxChars = 2000): Promise<string> {
  const pool = await getPoolFrom(deps)
  const { rows } = await pool.query(
    `SELECT content FROM node_knowledge_chunk WHERE doc_id = $1 AND user_id = $2 ORDER BY seq`,
    [id, deps.userId]
  )
  const text = rows.map((r: any) => String(r.content || '')).join('\n').trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…(已截断)` : text
}

/** 知识列表（时间倒序，关键词过滤标题/文件名） */
export async function listKnowledgeDocs(deps: KnowledgeDocDeps, keyword?: string, limit = 200): Promise<KnowledgeDocRow[]> {
  const pool = await getPoolFrom(deps)
  const dims = deps.embedding.dimensions || 1024
  await ensureKnowledgeTables(pool, dims)
  const { rows } = await pool.query(
    `SELECT * FROM node_knowledge_doc
     WHERE user_id = $1 AND ($2 = '' OR title ILIKE '%' || $2 || '%' OR COALESCE(file_name, '') ILIKE '%' || $2 || '%')
     ORDER BY updated_at DESC
     LIMIT $3`,
    [deps.userId, keyword?.trim() || '', limit]
  )
  return rows.map(toDoc)
}

/** 文档详情（含全部切片） */
export async function getKnowledgeDoc(deps: KnowledgeDocDeps, id: number): Promise<{ doc: KnowledgeDocRow; chunks: KnowledgeChunkRow[] } | null> {
  const pool = await getPoolFrom(deps)
  const { rows } = await pool.query(`SELECT * FROM node_knowledge_doc WHERE id = $1 AND user_id = $2`, [id, deps.userId])
  if (!rows.length) return null
  const { rows: chunks } = await pool.query(
    `SELECT id, doc_id, user_id, seq, content, char_count, created_at
     FROM node_knowledge_chunk WHERE doc_id = $1 AND user_id = $2 ORDER BY seq`,
    [id, deps.userId]
  )
  return {
    doc: toDoc(rows[0]),
    chunks: chunks.map((r: any) => ({
      id: Number(r.id),
      docId: Number(r.doc_id),
      userId: Number(r.user_id),
      seq: Number(r.seq),
      content: r.content,
      charCount: Number(r.char_count),
      createdAt: new Date(r.created_at).toISOString()
    }))
  }
}

/** 知识检索：query 向量化 → cosine 最近邻 top-k（带文档标题） */
export async function searchKnowledge(
  deps: KnowledgeDocDeps,
  query: string,
  topK = 5
): Promise<{ docId: number; docTitle: string; source: string; seq: number; content: string; score: number }[]> {
  const dims = deps.embedding.dimensions || 1024
  const [vec] = await EmbeddingService.embed([query], deps.embedding, deps.userId, dims)
  const pool = await getPoolFrom(deps)
  await ensureKnowledgeTables(pool, dims)
  const { rows } = await pool.query(
    `SELECT c.doc_id, c.seq, c.content, 1 - (c.embedding <=> $1::vector) AS score,
            d.title AS doc_title, d.source AS doc_source
     FROM node_knowledge_chunk c
     JOIN node_knowledge_doc d ON d.id = c.doc_id AND d.user_id = c.user_id
     WHERE c.user_id = $2 AND d.status = 'done'
     ORDER BY c.embedding <=> $1::vector
     LIMIT $3`,
    [`[${vec.join(',')}]`, deps.userId, topK]
  )
  return rows.map((r: any) => ({
    docId: Number(r.doc_id),
    docTitle: r.doc_title,
    source: r.doc_source,
    seq: Number(r.seq),
    content: r.content,
    score: Number(r.score)
  }))
}
