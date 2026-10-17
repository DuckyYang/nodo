import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import crypto from 'node:crypto'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'
import { getDecryptedSecrets } from '../config/config.router'
import {
  isKnowledgeReady,
  findDocByMd5,
  createKnowledgeDoc,
  listKnowledgeDocs,
  getKnowledgeDoc,
  deleteKnowledgeDoc,
  searchKnowledge
} from '../../services/KnowledgeStore'
import { processKnowledgeFile, KNOWLEDGE_EXTS, KNOWLEDGE_MAX_SIZE, getKnowledgeLogs, clearKnowledgeLogs } from '../../services/KnowledgePipeline'
import { UserConfig, type ModelItem } from '../../entities/UserConfig'
import { AppDataSource } from '../../data-source'

const router = Router()
router.use(authRequired)

/** 上传大小限制 5M（multer 层硬限制） */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: KNOWLEDGE_MAX_SIZE }
})

/** 解析用户知识库依赖（pg + 向量模型） */
async function requireDeps(userId: number) {
  const secrets = await getDecryptedSecrets(userId)
  if (!isKnowledgeReady(secrets.postgres, secrets.embedding)) {
    throw new HttpError(400, 'KNOWLEDGE_NOT_READY', '请先在配置中心配置 PostgreSQL（pgvector）与向量模型')
  }
  return {
    secrets,
    deps: { userId, pg: secrets.postgres!, embedding: secrets.embedding! }
  }
}

/**
 * 知识列表
 * GET /knowledge?keyword=
 */
router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const { deps } = await requireDeps(req.user!.id)
  const list = await listKnowledgeDocs(deps, String(req.query.keyword || ''))
  res.json({ list })
}))

/**
 * 知识抽取流水线日志（前端轮询：兜底 SSE knowledge_update 终态丢失，
 * 也用于知识页查看沉淀过程）
 */
router.get('/logs', asyncHandler(async (req: AuthedRequest, res) => {
  res.json({ logs: getKnowledgeLogs(req.user!.id) })
}))

/** 清空知识抽取日志 */
router.delete('/logs', asyncHandler(async (req: AuthedRequest, res) => {
  clearKnowledgeLogs(req.user!.id)
  res.json({ ok: true })
}))

/** 切片模型配置：读取（当前选中的 chat 模型 + 可选列表） */
router.get('/model', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await AppDataSource.getRepository(UserConfig).findOne({ where: { userId: req.user!.id } })
  const items: ModelItem[] = Array.isArray(cfg?.modelItems) ? cfg.modelItems : []
  const chatModels = items
    .filter((m) => m.type === 'chat')
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, baseUrl: m.baseUrl }))
  const selected = cfg?.modelPrefs?.knowledgeModelId || cfg?.modelPrefs?.memoryModelId || chatModels[0]?.id || ''
  res.json({ chatModels, selected })
}))

/** 切片模型配置：保存（校验必须是 chat 类型模型） */
router.put('/model', asyncHandler(async (req: AuthedRequest, res) => {
  const modelId = String(req.body?.modelId || '')
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  const cfg = await cfgRepo.findOne({ where: { userId: req.user!.id } })
  if (!cfg) throw new HttpError(404, 'NOT_FOUND', '配置不存在')
  const items: ModelItem[] = Array.isArray(cfg.modelItems) ? cfg.modelItems : []
  if (modelId && !items.find((m) => m.id === modelId && m.type === 'chat')) {
    throw new HttpError(400, 'INVALID_INPUT', '所选模型不存在或不是 chat 类型')
  }
  cfg.modelPrefs = { ...(cfg.modelPrefs || {}), knowledgeModelId: modelId || undefined }
  await cfgRepo.save(cfg)
  res.json({ ok: true })
}))

/**
 * 知识检索（测试/调试用）
 * GET /knowledge/search?q=&topK=
 * 注意：必须注册在 /:id 之前，否则 "search" 会被当作 :id
 */
router.get('/search', asyncHandler(async (req: AuthedRequest, res) => {
  const { deps } = await requireDeps(req.user!.id)
  const q = String(req.query.q || '').trim()
  if (!q) throw new HttpError(400, 'INVALID_INPUT', '缺少检索词 q')
  const topK = Math.min(Math.max(Number(req.query.topK) || 5, 1), 20)
  const list = await searchKnowledge(deps, q, topK)
  res.json({ list })
}))

/**
 * 知识详情（含全部切片）
 * GET /knowledge/:id
 */
router.get('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const { deps } = await requireDeps(req.user!.id)
  const detail = await getKnowledgeDoc(deps, Number(req.params.id))
  if (!detail) throw new HttpError(404, 'NOT_FOUND', '知识不存在')
  res.json(detail)
}))

/**
 * 上传文件入知识库：
 * 1. 校验类型/大小 → md5 去重（重复直接返回已有记录）
 * 2. 源文件存到 工作目录/knowledge/{docId}.原后缀
 * 3. 落 pending 记录后立即异步处理（解析→切片→向量化）
 * 前端轮询列表接口显示进度
 */
router.post('/upload', upload.single('file'), asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.file) throw new HttpError(400, 'INVALID_INPUT', '未收到文件')
  const { secrets, deps } = await requireDeps(req.user!.id)
  const workDir = secrets.workDir
  if (!workDir) throw new HttpError(400, 'NO_WORK_DIR', '请先在笔记模块选择工作目录')

  // 文件名修复（busboy latin1 乱码）
  let name = req.file.originalname
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8')
    if (!fixed.includes('\uFFFD')) name = fixed
  } catch { /* 保持原值 */ }
  const ext = path.extname(name).slice(1).toLowerCase()
  if (!KNOWLEDGE_EXTS.includes(ext)) {
    throw new HttpError(400, 'UNSUPPORTED_TYPE', `仅支持 ${KNOWLEDGE_EXTS.join(' / ')} 格式`)
  }
  if (req.file.size > KNOWLEDGE_MAX_SIZE) {
    throw new HttpError(400, 'TOO_LARGE', '文件大小不能超过 5MB')
  }

  // md5 去重（同用户同文件不重复处理）
  const md5 = crypto.createHash('md5').update(req.file.buffer).digest('hex')
  const existing = await findDocByMd5(deps, md5)
  if (existing) {
    return res.json({ duplicate: true, doc: existing })
  }

  // 建记录 → 存源文件（工作目录/knowledge/）→ 异步处理
  const title = path.basename(name, path.extname(name)) || '未命名文档'
  const doc = await createKnowledgeDoc(deps, {
    source: 'file',
    title,
    fileName: name,
    md5,
    size: req.file.size
  })
  const fs = await import('node:fs/promises')
  const dir = path.join(workDir, 'knowledge')
  await fs.mkdir(dir, { recursive: true })
  const safeName = `${doc.id}-${path.basename(name).replace(/[\\/:*?"<>|]/g, '_')}`
  const absPath = path.join(dir, safeName)
  await fs.writeFile(absPath, req.file.buffer)
  const relPath = `knowledge/${safeName}`
  // 回写源文件相对路径
  const { getPool } = await import('../../services/MemoryStore')
  const pool = await getPool(deps.userId, deps.pg)
  await pool.query(`UPDATE node_knowledge_doc SET rel_path = $3 WHERE id = $1 AND user_id = $2`, [doc.id, deps.userId, relPath])

  // 异步处理（不阻塞上传响应；切片模型优先 knowledgeModel）
  processKnowledgeFile(deps, secrets.knowledgeModel || secrets.memoryModel || secrets.model, doc.id, absPath).catch(() => {})
  res.json({ duplicate: false, doc: { ...doc, relPath } })
}))

/**
 * 重试处理（失败/中断后重建切片）
 * POST /knowledge/:id/retry
 */
router.post('/:id/retry', asyncHandler(async (req: AuthedRequest, res) => {
  const { secrets, deps } = await requireDeps(req.user!.id)
  const detail = await getKnowledgeDoc(deps, Number(req.params.id))
  if (!detail) throw new HttpError(404, 'NOT_FOUND', '知识不存在')
  if (detail.doc.source !== 'file' || !detail.doc.relPath || !secrets.workDir) {
    throw new HttpError(400, 'INVALID_INPUT', '仅文件型知识支持重试')
  }
  const absPath = path.resolve(secrets.workDir, detail.doc.relPath)
  const { updateDocStatus } = await import('../../services/KnowledgeStore')
  await updateDocStatus(deps, detail.doc.id, 'pending', undefined, { chunkCount: 0 })
  processKnowledgeFile(deps, secrets.knowledgeModel || secrets.memoryModel || secrets.model, detail.doc.id, absPath).catch(() => {})
  res.json({ ok: true })
}))

/**
 * 删除知识（连带切片；文件型同时删源文件）
 * DELETE /knowledge/:id
 */
router.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const { secrets, deps } = await requireDeps(req.user!.id)
  const detail = await getKnowledgeDoc(deps, Number(req.params.id))
  if (!detail) throw new HttpError(404, 'NOT_FOUND', '知识不存在')
  // 文件型：删除工作目录下的源文件
  if (detail.doc.source === 'file' && detail.doc.relPath && secrets.workDir) {
    const absPath = path.resolve(secrets.workDir, detail.doc.relPath)
    const fs = await import('node:fs/promises')
    await fs.unlink(absPath).catch(() => {})
  }
  const ok = await deleteKnowledgeDoc(deps, detail.doc.id)
  res.json({ ok })
}))

export { router as knowledgeRouter }
