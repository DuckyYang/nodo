import { Router } from 'express'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'
import { getDecryptedSecrets } from '../config/config.router'
import { AppDataSource } from '../../data-source'
import { UserConfig, type ModelItem } from '../../entities/UserConfig'
import {
  isMemoryReady,
  searchMemories,
  listMemories,
  updateMemory,
  deleteMemory,
  type MemoryKind
} from '../../services/MemoryStore'
import { getMemoryLogs, clearMemoryLogs } from '../../services/MemoryPipeline'

/**
 * 记忆管理接口（用户记忆 + 小助理记忆，按用户隔离）：
 * - GET  /memories          列表（query: kind, keyword）时间倒序
 * - GET  /memories/search   相关性检索（query: q, kind, topK）
 * - PUT  /memories/:id      修改（body: content/category/confidence；重新向量化）
 * - DELETE /memories/:id    删除
 * kind: user = 用户记忆 / assistant = 小助理记忆
 */
const router = Router()
router.use(authRequired)

/** 校验 kind 参数 */
function parseKind(raw: any): MemoryKind {
  return raw === 'assistant' ? 'assistant' : 'user'
}

/** 拿当前用户的记忆库依赖（pg + 向量模型配置）；未就绪抛 400 */
async function requireDeps(userId: number) {
  const secrets = await getDecryptedSecrets(userId)
  if (!isMemoryReady(secrets.postgres, secrets.embedding)) {
    throw new HttpError(400, 'MEMORY_NOT_READY', '请先在配置中心配置 PostgreSQL 与向量模型')
  }
  return { userId, pg: secrets.postgres!, embedding: secrets.embedding! }
}

/** 记忆流水线进度日志（前端轮询展示）；clear=1 清空 */
router.get('/logs', asyncHandler(async (req: AuthedRequest, res) => {
  if (req.query.clear === '1') {
    clearMemoryLogs(req.user!.id)
    return res.json({ list: [] })
  }
  res.json({ list: getMemoryLogs(req.user!.id) })
}))

/** 记忆模型配置：读取（当前选中的 chat 模型 + 可选列表） */
router.get('/model', asyncHandler(async (req: AuthedRequest, res) => {
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  const cfg = await cfgRepo.findOne({ where: { userId: req.user!.id } })
  const items: ModelItem[] = Array.isArray(cfg?.modelItems) ? cfg.modelItems : []
  const chatModels = items
    .filter((m) => m.type === 'chat')
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, baseUrl: m.baseUrl }))
  const selected = cfg?.modelPrefs?.memoryModelId || chatModels[0]?.id || ''
  res.json({ chatModels, selected })
}))

/** 记忆模型配置：保存（校验必须是 chat 类型模型） */
router.put('/model', asyncHandler(async (req: AuthedRequest, res) => {
  const modelId = String(req.body?.modelId || '')
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  const cfg = await cfgRepo.findOne({ where: { userId: req.user!.id } })
  if (!cfg) throw new HttpError(404, 'NOT_FOUND', '配置不存在')
  const items: ModelItem[] = Array.isArray(cfg.modelItems) ? cfg.modelItems : []
  if (modelId && !items.find((m) => m.id === modelId && m.type === 'chat')) {
    throw new HttpError(400, 'INVALID_INPUT', '所选模型不存在或不是 chat 类型')
  }
  cfg.modelPrefs = { ...(cfg.modelPrefs || {}), memoryModelId: modelId || undefined }
  await cfgRepo.save(cfg)
  res.json({ ok: true })
}))

/** 列表查询 */
router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const deps = await requireDeps(req.user!.id)
  const kind = parseKind(req.query.kind)
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : ''
  const list = await listMemories(deps, kind, keyword)
  res.json({ list })
}))

/** 相关性检索 */
router.get('/search', asyncHandler(async (req: AuthedRequest, res) => {
  const deps = await requireDeps(req.user!.id)
  const q = String(req.query.q || '').trim()
  if (!q) throw new HttpError(400, 'INVALID_INPUT', '检索内容不能为空')
  const kindRaw = req.query.kind
  const kind = kindRaw === 'user' || kindRaw === 'assistant' ? kindRaw : undefined
  const topK = Math.min(Math.max(Number(req.query.topK) || 10, 1), 50)
  const list = await searchMemories(deps, q, topK, kind as MemoryKind | undefined)
  res.json({ list })
}))

/** 修改记忆（重新向量化） */
router.put('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const deps = await requireDeps(req.user!.id)
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) throw new HttpError(400, 'INVALID_INPUT', '无效的记忆 ID')
  const kind = parseKind(req.query.kind)
  const { content, category, confidence } = req.body || {}
  if (content !== undefined && !String(content).trim()) {
    throw new HttpError(400, 'INVALID_INPUT', '记忆内容不能为空')
  }
  const row = await updateMemory(deps, kind, id, {
    content: typeof content === 'string' ? content.trim() : undefined,
    category: typeof category === 'string' ? category : undefined,
    confidence: Number.isFinite(Number(confidence)) ? Math.min(Math.max(Number(confidence), 0), 1) : undefined
  })
  if (!row) throw new HttpError(404, 'NOT_FOUND', '记忆不存在')
  res.json({ memory: row })
}))

/** 删除记忆 */
router.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const deps = await requireDeps(req.user!.id)
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) throw new HttpError(400, 'INVALID_INPUT', '无效的记忆 ID')
  const kind = parseKind(req.query.kind)
  const ok = await deleteMemory(deps, kind, id)
  if (!ok) throw new HttpError(404, 'NOT_FOUND', '记忆不存在')
  res.json({ ok: true })
}))

export { router as memoriesRouter }
