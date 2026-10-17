import pg from 'pg'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { PostgresConfig } from '../entities/UserConfig'

/**
 * PostgreSQL checkpointer 管理（HITL 中断-恢复持久化）：
 * - 按用户隔离连接池与 PostgresSaver 实例（配置变更时重建）
 * - saver.setup() 首次建表（checkpoints / checkpoint_writes / checkpoint_blobs）
 * - DeepAgentService 运行时通过 getCheckpointer 拿 saver；
 *   未配置 PostgreSQL 时返回 null，由调用方回退 MemorySaver
 */
const pools = new Map<number, { pool: pg.Pool; saver: PostgresSaver; signature: string }>()

/** 配置签名：变更即重建连接池 */
function signature(c: PostgresConfig): string {
  return `${c.host}|${c.port}|${c.user}|${c.password}|${c.database}`
}

function connConfig(c: PostgresConfig): pg.PoolConfig {
  return {
    host: c.host,
    port: c.port || 5432,
    user: c.user,
    password: c.password,
    database: c.database,
    max: 5,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 8_000
  }
}

/** 测试连通性并验证建表权限（独立短连接，不动用户连接池） */
export async function testPostgresConnection(c: PostgresConfig): Promise<void> {
  const pool = new pg.Pool({ ...connConfig(c), max: 1 })
  try {
    const saver = new PostgresSaver(pool)
    await saver.setup()
  } finally {
    await pool.end().catch(() => {})
  }
}

/** 配置是否完整可用 */
export function isPostgresConfigured(c?: PostgresConfig | null): c is PostgresConfig {
  return Boolean(c?.host && c?.user && c?.database && c?.password)
}

/**
 * 获取用户的 PostgresSaver（首次调用建池 + setup 建表）。
 * 连接失败抛错（调用方降级内存版并继续对话，不让 HITL 持久化问题阻塞聊天）。
 */
export async function getPostgresSaver(userId: number, c: PostgresConfig): Promise<PostgresSaver> {
  const sig = signature(c)
  const existing = pools.get(userId)
  if (existing && existing.signature === sig) return existing.saver
  // 配置变更：关闭旧池
  if (existing) {
    pools.delete(userId)
    await existing.pool.end().catch(() => {})
  }
  const pool = new pg.Pool(connConfig(c))
  const saver = new PostgresSaver(pool)
  await saver.setup()
  pools.set(userId, { pool, saver, signature: sig })
  return saver
}

/** 关闭指定用户的连接池（配置清空 / 应用退出时调用） */
export async function closePostgresPool(userId: number): Promise<void> {
  const entry = pools.get(userId)
  if (!entry) return
  pools.delete(userId)
  await entry.pool.end().catch(() => {})
}

/** 关闭全部连接池（应用退出） */
export async function closeAllPostgresPools(): Promise<void> {
  await Promise.allSettled([...pools.keys()].map((uid) => closePostgresPool(uid)))
}

/** DeepAgentService 用的统一入口：返回 saver 或 null（未配置/连接失败） */
export async function resolveCheckpointer(
  userId: number,
  c?: PostgresConfig | null
): Promise<BaseCheckpointSaver | null> {
  if (!isPostgresConfigured(c)) return null
  try {
    return await getPostgresSaver(userId, c)
  } catch {
    // 连接失败降级内存版（本轮对话仍可用，中断状态不跨重启）
    return null
  }
}
