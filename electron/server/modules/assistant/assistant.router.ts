import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'
import { getDecryptedSecrets } from '../config/config.router'
import { AppDataSource } from '../../data-source'
import { ChatSession, type ChatMsgRecord } from '../../entities/ChatSession'
import { UserConfig } from '../../entities/UserConfig'
import { User } from '../../entities/User'
import { runDeepAgent, abortRun } from '../../services/DeepAgentService'
import { LLMService } from '../../services/LLMService'
import { isExtractable } from '../../services/FileTextExtractor'
import { ensureSessionUploadDir } from '../../services/WorkspaceFs'
import { listSkills, installSkillZip, installSkillMd, deleteSkill } from '../../services/SkillService'
import { subscribeWxEvents } from '../../services/WxEventBus'
import { isMemoryReady, searchMemories } from '../../services/MemoryStore'
import { runMemoryPipeline } from '../../services/MemoryPipeline'
import { runKnowledgeExtraction, isKnowledgePipelineReady } from '../../services/KnowledgePipeline'

const router = Router()
router.use(authRequired)

/**
 * 挂起中的 HITL 确认（/chat 内创建，/confirm 端点 resolve）：
 * key = `${userId}:${sessionId}`，值 = { resolve, timer }
 */
const pendingHitl = new Map<string, { resolve: (d: 'approve' | 'reject' | 'ignore') => void; timer: NodeJS.Timeout }>()

/** HITL 确认超时（10 分钟无人选择自动忽略，释放挂起的运行） */
const HITL_TIMEOUT_MS = 10 * 60 * 1000

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

/**
 * 修复 multer/busboy 中文文件名乱码：
 * busboy 默认按 latin1 解码 filename，浏览器实际以 UTF-8 发送，
 * 重编码 latin1 → buffer → utf8 还原真实文件名
 */
function fixFilename(name: string): string {
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8')
    // 含替换字符说明源本就不是 latin1 误读，保持原值
    return fixed.includes('\uFFFD') ? name : fixed
  } catch {
    return name
  }
}

function sessionRepo() {
  return AppDataSource.getRepository(ChatSession)
}

/** 用模型为首条用户问题生成会话主题（≤10字），失败退化为截断原文 */
async function generateTitle(userId: number, question: string): Promise<string> {
  try {
    const secrets = await getDecryptedSecrets(userId)
    const llm = LLMService.build(secrets.model, userId)
    if (!llm) return truncate(question)
    const resp = await llm.invoke(
      `根据下面的用户提问生成一个不超过10个字的中文对话主题，直接输出主题本身，不要任何解释、引号或标点结尾。\n\n用户提问：${question}`
    )
    const text = typeof resp.content === 'string' ? resp.content.trim() : ''
    return text ? text.slice(0, 20) : truncate(question)
  } catch {
    return truncate(question)
  }
}

function truncate(q: string) {
  const s = q.replace(/\s+/g, ' ').trim()
  return s.length > 16 ? s.slice(0, 16) + '…' : s || '新对话'
}

/** 用户模型列表（含旧数据迁移） */
async function getModelItems(userId: number) {
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  const cfg = await cfgRepo.findOne({ where: { userId } })
  return Array.isArray(cfg?.modelItems) ? cfg.modelItems : []
}

/** 历史会话（无 modelId）的回填模型：deepseek 命名优先 → 第一个 chat */
async function resolveLegacyChatModelId(userId: number): Promise<string | null> {
  const items = await getModelItems(userId)
  const chats = items.filter((m) => m.type === 'chat')
  return chats.find((m) => /deepseek/i.test(m.name))?.id || chats[0]?.id || null
}

/** 校验模型存在且类型为 chat */
async function isValidChatModel(userId: number, modelId: string): Promise<boolean> {
  const items = await getModelItems(userId)
  return items.some((m) => m.id === modelId && m.type === 'chat')
}

/** 记住最近使用的 chat 模型（下次新对话默认） */
async function rememberLastChatModel(userId: number, modelId: string) {
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  const cfg = await cfgRepo.findOne({ where: { userId } })
  if (!cfg) return
  cfg.modelPrefs = { ...(cfg.modelPrefs || {}), lastChatModelId: modelId }
  await cfgRepo.save(cfg)
}

/** 从解析结果反查模型列表 id（name + baseUrl 匹配；找不到返回 null） */
async function extractModelIdFromSecrets(userId: number, secrets: any): Promise<string | null> {
  if (!secrets?.model?.name) return null
  const items = await getModelItems(userId)
  const hit = items.find((m) => m.type === 'chat' && m.name === secrets.model.name && m.baseUrl === secrets.model.baseUrl)
  return hit?.id || null
}

/**
 * 可选 chat 模型 + 默认选中（最近使用；无记录时 deepseek 命名优先 → 第一个 chat）
 * GET /assistant/models
 */
router.get('/models', asyncHandler(async (req: AuthedRequest, res) => {
  const items = await getModelItems(req.user!.id)
  const chatModels = items
    .filter((m) => m.type === 'chat')
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, baseUrl: m.baseUrl }))
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  const cfg = await cfgRepo.findOne({ where: { userId: req.user!.id } })
  const last = cfg?.modelPrefs?.lastChatModelId
  const selected =
    (last && chatModels.find((m) => m.id === last)?.id) ||
    chatModels.find((m) => /deepseek/i.test(m.name))?.id ||
    chatModels[0]?.id ||
    ''
  res.json({ chatModels, selected })
}))

/**
 * 会话列表（按 updatedAt 倒序）
 * GET /assistant/sessions
 */
router.get('/sessions', asyncHandler(async (req: AuthedRequest, res) => {
  const list = await sessionRepo().find({
    where: { userId: req.user!.id },
    order: { updatedAt: 'DESC' },
    select: ['id', 'title', 'source', 'memoryEnabled', 'modelId', 'createdAt', 'updatedAt']
  })
  res.json({ list })
}))

/**
 * 会话详情（含消息归档）
 * GET /assistant/sessions/:id
 */
router.get('/sessions/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const s = await sessionRepo().findOne({
    where: { id: Number(req.params.id), userId: req.user!.id }
  })
  if (!s) throw new HttpError(404, 'NOT_FOUND', '会话不存在')
  res.json({ session: { id: s.id, title: s.title, source: s.source, memoryEnabled: s.memoryEnabled, modelId: s.modelId, messages: s.messages || [], updatedAt: s.updatedAt } })
}))

/**
 * 删除会话
 * DELETE /assistant/sessions/:id
 */
router.delete('/sessions/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = sessionRepo()
  const s = await repo.findOne({
    where: { id: Number(req.params.id), userId: req.user!.id }
  })
  if (!s) throw new HttpError(404, 'NOT_FOUND', '会话不存在')
  await repo.remove(s)
  res.json({ ok: true })
}))

/**
 * 对话：SSE 流式返回
 * body: { message: string; sessionId?: number; attachments?: {name, relPath, size}[] }
 */
router.post('/chat', asyncHandler(async (req: AuthedRequest, res) => {
  const { message, sessionId } = req.body || {}
  if (!message || !String(message).trim()) throw new HttpError(400, 'INVALID_INPUT', '消息不能为空')

  // 会话定位先于密钥解析：续聊用会话记忆的模型，新会话用请求指定/最近使用的模型
  const repo = sessionRepo()
  let session: ChatSession | null = null
  if (sessionId) {
    session = await repo.findOne({ where: { id: Number(sessionId), userId: req.user!.id } })
    if (!session) throw new HttpError(404, 'NOT_FOUND', '会话不存在')
  }

  // 本轮使用的 chat 模型 id（会话级）：续聊 = 会话保存的 modelId；新会话 = 请求指定 → 最近使用
  const reqModelId = typeof req.body?.modelId === 'string' && req.body.modelId ? req.body.modelId : null
  let useModelId: string | null = null
  if (session?.modelId) {
    // 已有会话：固定用创建/上次对话的模型（历史会话回填：deepseek 命名优先，否则第一个 chat）
    useModelId = session.modelId
  } else if (session) {
    useModelId = await resolveLegacyChatModelId(req.user!.id) || reqModelId
  } else {
    useModelId = reqModelId || (await resolveLegacyChatModelId(req.user!.id))
  }

  // 校验模型存在且类型为 chat；非法则回退默认解析
  if (useModelId && !(await isValidChatModel(req.user!.id, useModelId))) useModelId = null
  const secrets = await getDecryptedSecrets(req.user!.id, { chatModelId: useModelId })
  if (!secrets.model.apiKey) throw new HttpError(400, 'NO_MODEL', '请先在配置中心配置模型 api_key')

  // 新会话或历史会话首次补填：把模型写进会话 + 记住最近选择
  if (!session || !session.modelId) {
    const finalModelId = useModelId || (await extractModelIdFromSecrets(req.user!.id, secrets))
    if (finalModelId) {
      if (session) {
        session.modelId = finalModelId
        await repo.update(session.id, { modelId: finalModelId })
      } else {
        ;(req as any).__modelIdToBind = finalModelId
      }
      // 记住最近选择（下次新对话默认使用）
      rememberLastChatModel(req.user!.id, finalModelId).catch(() => {})
    }
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // 会话定位：传入 sessionId 续聊，否则新建
  let sessionFinal: ChatSession | null = session
  if (!sessionFinal) {
    sessionFinal = new ChatSession()
    sessionFinal.userId = req.user!.id
    sessionFinal.title = ''
    sessionFinal.messages = []
    // 来源渠道：app = 小助理页面（默认），quick_todo/quick_notes = 待办/笔记页快捷弹层
    sessionFinal.source = typeof req.body?.source === 'string' && req.body.source.length <= 16 ? req.body.source : 'app'
    // 记忆开关：仅新会话时可设置（发起对话后不可切换）
    sessionFinal.memoryEnabled = req.body?.memoryEnabled !== false
    // 新会话绑定本轮使用的模型
    sessionFinal.modelId = (req as any).__modelIdToBind || useModelId || null
  }
  session = sessionFinal

  // 先落库用户消息（新会话在此获得自增 id；同时刷新 updatedAt，列表排序正确）
  // attachments 结构化归档：前端纯附件发送时 message 可能为空占位
  const rawAtts: { name: string; relPath: string; size: number }[] = Array.isArray(req.body?.attachments) ? req.body.attachments : []
  const userMsg: ChatMsgRecord = {
    role: 'user',
    content: message,
    attachments: rawAtts.length ? rawAtts : undefined,
    at: new Date().toISOString()
  }
  session.messages = [...(session.messages || []), userMsg]
  if (!session.title) session.title = truncate(message)
  await repo.save(session)
  const sid = session.id

  // 附件归位：draft 会话上传的文件移动到真实会话 id 目录下
  let attachments = rawAtts
  if (rawAtts.length && secrets.workDir) {
    const moved: typeof rawAtts = []
    for (const a of rawAtts) {
      try {
        const oldAbs = path.resolve(secrets.workDir, a.relPath)
        // 仅移动 app_work_space/draft/ 下、且还在边界内的文件
        const relNorm = path.relative(secrets.workDir, oldAbs).replace(/\\/g, '/')
        if (relNorm.startsWith('app_work_space/draft/')) {
          const newPath = relNorm.replace('app_work_space/draft/', `app_work_space/${sid}/`)
          const newAbs = path.resolve(secrets.workDir, newPath)
          const fs = await import('node:fs/promises')
          await fs.mkdir(path.dirname(newAbs), { recursive: true })
          await fs.rename(oldAbs, newAbs).catch(() => {})
          moved.push({ ...a, relPath: newPath })
        } else {
          moved.push(a)
        }
      } catch {
        moved.push(a)
      }
    }
    // 归档移动后的路径，保证历史会话里的附件路径可解析
    if (moved.some((m, i) => m.relPath !== rawAtts[i].relPath)) {
      const fresh = await repo.findOne({ where: { id: sid } })
      if (fresh) {
        const msgs = fresh.messages || []
        if (msgs.length) msgs[msgs.length - 1].attachments = moved
        await repo.update(sid, { messages: msgs })
      }
      attachments = moved
    }
  }

  // 客户端断开（关闭页面/停止按钮）→ 中止智能体
  const runKey = `u${req.user!.id}-s${sid}`
  req.on('close', () => {
    abortRun(runKey)
    // 挂起的 HITL 确认按忽略处理，释放等待的运行
    const key = `${req.user!.id}:${sid}`
    const hitl = pendingHitl.get(key)
    if (hitl) {
      clearTimeout(hitl.timer)
      pendingHitl.delete(key)
      hitl.resolve('ignore')
    }
  })

  try {
    send('session', { id: sid, title: session.title })

    // 首轮对话异步生成主题（不阻塞回复流）
    if (session.messages.length <= 1) {
      generateTitle(req.user!.id, message).then((title) => {
        repo.update(sid, { title }).catch(() => {})
      })
    }

    // 记忆检索：会话开启记忆且向量库就绪时，检索相关记忆注入系统提示词
    let memoryContext = ''
    // 知识库开关（本轮对话）：开启时挂载知识工具 + 对话后知识抽取入库
    const knowledgeEnabled = req.body?.knowledgeEnabled === true
    const memDeps = {
      userId: req.user!.id,
      pg: secrets.postgres!,
      embedding: secrets.embedding!
    }
    if (session.memoryEnabled && isMemoryReady(secrets.postgres, secrets.embedding)) {
      try {
        const hits = await searchMemories(memDeps, message, 8)
        if (hits.length) {
          // 带记忆年龄与折减后可信度（时间越久远可靠性越低，提示模型谨慎对待）
          memoryContext = hits
            .map((h) => {
              const conf = ((h.confidence ?? 0.8) * h.decay).toFixed(2)
              return `- （${h.ageLabel}记忆，可信度 ${conf}）${h.content}`
            })
            .join('\n')
        }
      } catch { /* 检索失败不阻塞对话 */ }
    }

    let replyMsg: ChatMsgRecord | null = null
    let replySaved = false
    // 本轮 HITL 确认记录（含用户最终选择，归档到 AI 消息）
    let hitlRecord: ChatMsgRecord['hitl'] | undefined
    const persistReply = async () => {
      if (!replyMsg || replySaved) return
      replySaved = true
      // 以数据库当前值为基础追加，避免内存快照覆盖并发写入
      const fresh = await repo.findOne({ where: { id: sid } })
      if (!fresh) return
      const base = fresh.messages || []
      if (base[base.length - 1]?.role === 'assistant' && base[base.length - 1]?.at === replyMsg.at) return
      if (hitlRecord) replyMsg.hitl = hitlRecord
      await repo.update(sid, { messages: [...base, replyMsg] as ChatMsgRecord[] })
    }
    await runDeepAgent({
      userId: req.user!.id,
      // 用户显示名（系统提示词身份注入；未设置时模型侧显示未设置姓名）
      userName: (await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } }))?.name || undefined,
      message,
      sessionId: sid,
      attachments,
      // 用户在本轮激活的技能目录名（输入框 / 激活），动态挂载
      activeSkills: Array.isArray(req.body?.activeSkills) ? req.body.activeSkills.filter((s: any) => typeof s === 'string') : [],
      // 联网检索开关：关闭时不挂载 web_search 工具与调研子代理
      webSearchEnabled: req.body?.webSearchEnabled !== false,
      // 知识库开关：开启时挂载 knowledge_search / save_knowledge 工具，
      // 对话完成后异步触发事实性知识抽取入库
      knowledgeEnabled: knowledgeEnabled,
      // 检索到的相关记忆（注入系统提示词；空串 = 未开启/无记忆）
      memoryContext,
      threadKey: runKey,
      history: (session.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant'),
      secrets,
      onToken: (t) => send('token', { v: t }),
      onThought: (t) => send('thought', { v: t }),
      onTool: (info) => send('tool', info),
      // HITL：破坏性工具触发 interrupt → 推送确认卡到前端气泡，
      // 挂起等待用户选择（/confirm resolve）；SSE 断开视为忽略
      onHitl: (task) =>
        new Promise<'approve' | 'reject' | 'ignore'>((resolve) => {
          send('hitl', { tool: task.tool, input: task.input, prompt: task.prompt })
          hitlRecord = { tool: task.tool, input: task.input, prompt: task.prompt }
          const key = `${req.user!.id}:${sid}`
          // 同会话旧确认未处理时先按忽略清理（理论上不会发生）
          const stale = pendingHitl.get(key)
          if (stale) {
            clearTimeout(stale.timer)
            stale.resolve('ignore')
          }
          const timer = setTimeout(() => {
            pendingHitl.delete(key)
            hitlRecord && (hitlRecord.decision = 'ignore')
            resolve('ignore')
            send('hitl_timeout', {})
          }, HITL_TIMEOUT_MS)
          pendingHitl.set(key, {
            resolve: (d) => {
              hitlRecord && (hitlRecord.decision = d)
              resolve(d)
            },
            timer
          })
        }),
      onReply: (m) => {
        replyMsg = { ...m, at: new Date().toISOString() }
        // 回复一就绪立即落库（不等流关闭，防止连接中断丢失归档）
        persistReply().catch(() => {})
        // 记忆提取：会话开启记忆且向量库就绪时，异步执行记忆流水线（不阻塞流）
        // 进度通过 SSE memory_update 事件推给前端（回答完毕后显示「记忆更新中」）
        if (session!.memoryEnabled && isMemoryReady(secrets.postgres, secrets.embedding)) {
          runMemoryPipeline({
            userId: req.user!.id,
            model: secrets.memoryModel || secrets.model,
            deps: memDeps,
            sessionId: sid,
            userMessage: message,
            assistantMessage: m.content,
            onProgress: (p) => {
              try {
                send('memory_update', { sessionId: sid, status: p.status, detail: p.detail, runId: p.runId })
              } catch { /* 连接已断开则忽略 */ }
            }
          }).catch((e) => console.error('[memory-pipeline]', e?.message || e))
        }
        // 知识沉淀：本轮开启知识库开关且知识库就绪时，对话完成后异步
        // 执行独立的知识抽取任务（提取事实性知识 → 切片向量化入库），
        // 进度通过 SSE knowledge_update 事件推给前端
        if (knowledgeEnabled && isKnowledgePipelineReady(secrets.postgres, secrets.embedding)) {
          runKnowledgeExtraction({
            userId: req.user!.id,
            model: secrets.knowledgeModel || secrets.memoryModel || secrets.model,
            deps: memDeps,
            sessionId: sid,
            userMessage: message,
            assistantMessage: m.content,
            onProgress: (p) => {
              try {
                send('knowledge_update', { sessionId: sid, status: p.status, detail: p.detail, runId: p.runId })
              } catch { /* 连接已断开则忽略 */ }
            }
          }).catch((e) => console.error('[knowledge-extract]', e?.message || e))
        }
      },
      onDone: () => {
        send('done', { sessionId: sid, usage: replyMsg?.usage })
        persistReply().catch(() => {})
      },
      onError: (e) => {
        send('error', { message: e.message })
        // 出错也归档已生成的部分
        if (!replyMsg) replyMsg = { role: 'assistant', content: `(出错: ${e.message})`, at: new Date().toISOString() }
        persistReply().catch(() => {})
      }
    })

    // 兜底归档（中断/出错时 onReply 未触发的场景）
    if (!replyMsg) {
      const final: ChatMsgRecord = { role: 'assistant', content: '(已中断)', at: new Date().toISOString() }
      await repo.update(sid, { messages: [...(session.messages || []), final] as ChatMsgRecord[] }).catch(() => {})
    }
  } catch (e: any) {
    send('error', { message: e.message || '智能体执行失败' })
  } finally {
    res.end()
  }
}))

/**
 * 获取本会话的上传目录（不存在则创建）
 * GET /assistant/upload-dir  query: sessionId（可选，未建会话时为 draft）
 * 返回 { relPath }
 */
router.get('/upload-dir', asyncHandler(async (req: AuthedRequest, res) => {
  const secrets = await getDecryptedSecrets(req.user!.id)
  if (!secrets.workDir) throw new HttpError(400, 'NO_WORK_DIR', '请先在笔记模块选择工作目录')
  const sid = String(req.query.sessionId || 'draft').replace(/[^a-zA-Z0-9_-]/g, '')
  await ensureSessionUploadDir(secrets.workDir, sid)
  res.json({ relPath: `app_work_space/${sid}/upload` })
}))

/**
 * 上传文件：存到 工作目录/app_work_space/{sessionId|draft}/upload/ 下
 * POST /assistant/upload  multipart: file
 * query: sessionId（可选，未建会话时存 draft）
 * 返回 { name, relPath, size }
 */
router.post('/upload', upload.single('file'), asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.file) throw new HttpError(400, 'INVALID_INPUT', '未收到文件')
  const secrets = await getDecryptedSecrets(req.user!.id)
  const workDir = secrets.workDir
  if (!workDir) throw new HttpError(400, 'NO_WORK_DIR', '请先在笔记模块选择工作目录')

  // 后缀校验：仅接受可解析文本的常规文件
  const name = fixFilename(req.file.originalname)
  if (!isExtractable(name)) {
    throw new HttpError(400, 'UNSUPPORTED_TYPE', `不支持解析该文件类型: ${path.extname(name) || name}`)
  }

  // 按会话隔离：app_work_space/{sessionId|draft}/upload/文件名（冲突则覆盖同名）
  const sid = String(req.query.sessionId || 'draft').replace(/[^a-zA-Z0-9_-]/g, '')
  const safeName = path.basename(name).replace(/[\\/:*?"<>|]/g, '_')
  const relPath = `app_work_space/${sid}/upload/${safeName}`

  const absDir = await ensureSessionUploadDir(workDir, sid)
  const fs = await import('node:fs/promises')
  await fs.writeFile(path.join(absDir, safeName), req.file.buffer)

  res.json({ name: safeName, relPath, size: req.file.size })
}))

/**
 * 技能管理：已安装技能清单（扫描 工作目录/agent-skills/）
 * GET /assistant/skills
 */
router.get('/skills', asyncHandler(async (req: AuthedRequest, res) => {
  const secrets = await getDecryptedSecrets(req.user!.id)
  if (!secrets.workDir) throw new HttpError(400, 'NO_WORK_DIR', '请先在笔记模块选择工作目录')
  res.json({ list: await listSkills(secrets.workDir) })
}))

/**
 * 上传技能包：.zip（内含 SKILL.md）或单个 SKILL.md
 * POST /assistant/skills/upload  multipart: file
 * 校验通过后安装到 工作目录/agent-skills/{name}/
 */
router.post('/skills/upload', upload.single('file'), asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.file) throw new HttpError(400, 'INVALID_INPUT', '未收到文件')
  const secrets = await getDecryptedSecrets(req.user!.id)
  const workDir = secrets.workDir
  if (!workDir) throw new HttpError(400, 'NO_WORK_DIR', '请先在笔记模块选择工作目录')

  const name = fixFilename(req.file.originalname)
  const lower = name.toLowerCase()
  if (lower.endsWith('.zip')) {
    const skill = await installSkillZip(workDir, req.file.buffer)
    res.json({ skill })
  } else if (lower.endsWith('.md')) {
    // 单文件上传要求文件名必须为 SKILL.md（否则无法定位为技能入口）
    if (path.basename(lower) !== 'skill.md') {
      throw new HttpError(400, 'INVALID_SKILL_FILE', `Markdown 文件名必须为 SKILL.md（当前: ${path.basename(name)}）`)
    }
    const skill = await installSkillMd(workDir, name, req.file.buffer.toString('utf8'))
    res.json({ skill })
  } else {
    throw new HttpError(400, 'UNSUPPORTED_TYPE', '仅支持 .zip 技能压缩包或 SKILL.md 文件')
  }
}))

/**
 * 删除技能
 * DELETE /assistant/skills/:dirName
 */
router.delete('/skills/:dirName', asyncHandler(async (req: AuthedRequest, res) => {
  const secrets = await getDecryptedSecrets(req.user!.id)
  if (!secrets.workDir) throw new HttpError(400, 'NO_WORK_DIR', '请先在笔记模块选择工作目录')
  await deleteSkill(secrets.workDir, String(req.params.dirName))
  res.json({ ok: true })
}))

/**
 * 微信渠道实时事件流（SSE）
 * GET /assistant/wx-events
 * 前端打开微信会话时订阅，实时显示用户消息与小助理回复过程
 */
router.get('/wx-events', (req: AuthedRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  // 心跳（30s 一次，防止代理层断开空闲连接）
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { /* 连接已断 */ }
  }, 30000)
  const unsubscribe = subscribeWxEvents(req.user!.id, ({ event, data }) => {
    try {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch { /* 连接已断 */ }
  })
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

/**
 * 停止当前对话
 * POST /assistant/stop  body: { sessionId }
 */
router.post('/stop', asyncHandler(async (req: AuthedRequest, res) => {
  const { sessionId } = req.body || {}
  abortRun(`u${req.user!.id}-s${sessionId}`)
  res.json({ ok: true })
}))

/**
 * HITL 确认：用户对破坏性工具（delete_todo 等）的选择
 * POST /assistant/confirm  body: { sessionId, decision: 'approve' | 'reject' | 'ignore' }
 * resolve /chat 挂起的 onHitl Promise → DeepAgentService resume 断点续跑
 */
router.post('/confirm', asyncHandler(async (req: AuthedRequest, res) => {
  const { sessionId, decision } = req.body || {}
  const key = `${req.user!.id}:${sessionId}`
  const hitl = pendingHitl.get(key)
  if (!hitl) throw new HttpError(404, 'NO_PENDING_HITL', '当前没有等待确认的操作')
  if (!['approve', 'reject', 'ignore'].includes(decision)) {
    throw new HttpError(400, 'INVALID_INPUT', '无效的确认类型')
  }
  clearTimeout(hitl.timer)
  pendingHitl.delete(key)
  hitl.resolve(decision)
  res.json({ ok: true })
}))

export { router as assistantRouter }
