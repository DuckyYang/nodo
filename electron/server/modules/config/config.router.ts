import { Router } from 'express'
import { AppDataSource } from '../../data-source'
import { User } from '../../entities/User'
import { UserConfig, ModelConfig, BochaConfig, WeChatConfig, PostgresConfig, EmbeddingConfig, ModelItem, ModelType } from '../../entities/UserConfig'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'
import { encrypt, decrypt, maskKey } from '../../utils/SecretStore'
import { WeChatClawBotService } from '../../services/WeChatClawBotService'
import { onClawBotBound, stopClawBotPoller } from '../../services/ClawBotPoller'

const router = Router()
router.use(authRequired)

async function getOrCreateConfig(userId: number): Promise<UserConfig> {
  const repo = AppDataSource.getRepository(UserConfig)
  let cfg = await repo.findOne({ where: { userId } })
  if (!cfg) {
    cfg = repo.create({ userId, themeDefault: 'light', themeFollowTime: true, langDefault: 'zh' })
    await repo.save(cfg)
  }
  return cfg
}

const MODEL_TYPES: ModelType[] = ['chat', 'embedding', 'rerank', 'ocr', 'tts', 'asr']

/** 生成 8 位随机 id */
function newModelId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * 模型列表读取（旧数据自动迁移）：
 * model_items 存在直接用；否则从旧 modelConfig（chat）+ embeddingConfig（embedding）
 * 合成初始列表（不回写，仅在保存时落库）。
 */
function resolveModelItems(cfg: UserConfig): ModelItem[] {
  if (Array.isArray(cfg.modelItems)) return cfg.modelItems
  const items: ModelItem[] = []
  const mc = cfg.modelConfig
  if (mc?.name && mc.baseUrl) {
    items.push({
      id: newModelId(),
      type: 'chat',
      name: mc.name,
      provider: mc.provider || 'custom',
      apiKey: mc.apiKey || '',
      baseUrl: mc.baseUrl,
      temperature: typeof mc.temperature === 'number' ? mc.temperature : 0.3,
      thinking: mc.thinking ?? false,
      extraBody: mc.extraBody || ''
    })
  }
  const ec = cfg.embeddingConfig
  if (ec?.name && ec.baseUrl) {
    items.push({
      id: newModelId(),
      type: 'embedding',
      name: ec.name,
      provider: ec.provider || 'custom',
      apiKey: ec.apiKey || '',
      baseUrl: ec.baseUrl,
      dimensions: ec.dimensions || 1024
    })
  }
  return items
}

/** 列表中按 id 取模型（解密 apiKey）；找不到返回 null */
function findModel(items: ModelItem[], id: string, userId: number): (ModelItem & { apiKey: string }) | null {
  const it = items.find((m) => m.id === id)
  if (!it) return null
  return { ...it, apiKey: it.apiKey ? decrypt(it.apiKey, userId) : '' }
}

// 用户信息
router.put('/profile', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(User)
  const u = await repo.findOne({ where: { id: req.user!.id }, select: ['id'] })
  if (!u) throw new HttpError(404, 'NOT_FOUND', '用户不存在')
  const { name, phone, avatarPath } = req.body || {}
  if (name !== undefined) u.name = String(name).slice(0, 64)
  if (phone !== undefined) u.phone = String(phone).slice(0, 32)
  if (avatarPath !== undefined) u.avatarPath = String(avatarPath).slice(0, 255)
  await repo.save(u)
  res.json({ ok: true })
}))

// 完整配置读取（含掩码的密钥）
router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const masked: any = { ...cfg, modelConfig: undefined, bochaConfig: undefined, wechatConfig: undefined, postgresConfig: undefined, embeddingConfig: undefined }
  if (cfg.modelConfig) {
    masked.modelConfig = { ...cfg.modelConfig, apiKey: maskKey(cfg.modelConfig.apiKey) }
  }
  if (cfg.bochaConfig) {
    masked.bochaConfig = { ...cfg.bochaConfig, apiKey: maskKey(cfg.bochaConfig.apiKey) }
  }
  if (cfg.wechatConfig) {
    masked.wechatConfig = { ...cfg.wechatConfig, botToken: maskKey(cfg.wechatConfig.botToken) }
  }
  if (cfg.postgresConfig) {
    masked.postgresConfig = { ...cfg.postgresConfig, password: maskKey(cfg.postgresConfig.password) }
  }
  if (cfg.embeddingConfig) {
    masked.embeddingConfig = { ...cfg.embeddingConfig, apiKey: maskKey(cfg.embeddingConfig.apiKey) }
  }
  // 模型列表（含旧数据自动迁移；apiKey 掩码）
  masked.modelItems = resolveModelItems(cfg).map((m) => ({ ...m, apiKey: maskKey(m.apiKey) }))
  res.json({ config: masked })
}))

// ==================== 模型列表（chat/embedding/rerank/ocr/tts/asr） ====================

/** 新增/更新模型：body 带 id = 更新，不带 = 新增 */
router.put('/models', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const items = resolveModelItems(cfg)

  const type: ModelType = MODEL_TYPES.includes(incoming.type) ? incoming.type : 'chat'
  const name = String(incoming.name || '').trim()
  if (!name) throw new HttpError(400, 'BAD_REQUEST', '模型名称不能为空')

  const build: ModelItem = {
    id: incoming.id ? String(incoming.id) : newModelId(),
    type,
    name,
    provider: incoming.provider ? String(incoming.provider) : 'custom',
    baseUrl: String(incoming.baseUrl || '').trim(),
    temperature: Number.isFinite(Number(incoming.temperature)) ? Number(incoming.temperature) : (type === 'chat' ? 0.3 : undefined),
    thinking: type === 'chat' ? incoming.thinking === true : undefined,
    extraBody: type === 'chat' && typeof incoming.extraBody === 'string' && incoming.extraBody.trim() ? incoming.extraBody.trim() : undefined,
    dimensions: type === 'embedding' && Number.isFinite(Number(incoming.dimensions)) && Number(incoming.dimensions) > 0 ? Number(incoming.dimensions) : undefined,
    apiKey: typeof incoming.apiKey === 'string' && incoming.apiKey !== ''
      ? encrypt(incoming.apiKey, req.user!.id)
      : undefined
  }

  const idx = incoming.id ? items.findIndex((m) => m.id === incoming.id) : -1
  if (idx >= 0) {
    // 更新：未传 apiKey 时保留旧值
    items[idx] = { ...items[idx], ...build, apiKey: build.apiKey || items[idx].apiKey }
  } else {
    items.push(build)
  }
  cfg.modelItems = items
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true, model: { ...build, apiKey: maskKey(build.apiKey) } })
}))

/** 删除模型 */
router.delete('/models/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const items = resolveModelItems(cfg)
  const next = items.filter((m) => m.id !== req.params.id)
  if (next.length === items.length) throw new HttpError(404, 'NOT_FOUND', '模型不存在')
  cfg.modelItems = next
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true })
}))

/** 测试模型连通性（chat/embedding；其余类型仅校验字段） */
router.post('/models/test', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const items = resolveModelItems(cfg)
  const type: ModelType = MODEL_TYPES.includes(incoming.type) ? incoming.type : 'chat'
  const name = String(incoming.name || '').trim()
  const baseUrl = String(incoming.baseUrl || '').trim()
  // 密钥：明文传入优先，否则用已存（解密）
  const apiKey = typeof incoming.apiKey === 'string' && incoming.apiKey !== ''
    ? incoming.apiKey
    : (incoming.id ? findModel(items, String(incoming.id), req.user!.id)?.apiKey || '' : '')
  if (!name || !baseUrl || !apiKey) {
    throw new HttpError(400, 'BAD_REQUEST', '请完整填写模型名称、接口地址与密钥')
  }

  if (type === 'embedding') {
    const { EmbeddingService } = await import('../../services/EmbeddingService')
    const dims = await EmbeddingService.probe({ name, baseUrl, apiKey } as EmbeddingConfig, req.user!.id)
    return res.json({ ok: true, dimensions: dims })
  }
  // chat/rerank/ocr/tts/asr：发一次轻量 chat 请求验证连通（OpenAI 兼容）
  try {
    const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: name, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, stream: false }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`模型请求失败（${resp.status}）：${detail.slice(0, 200)}`)
    }
    res.json({ ok: true })
  } catch (e: any) {
    throw new HttpError(400, 'MODEL_TEST_FAILED', e?.message || '模型测试失败')
  }
}))

// 模型配置
router.put('/model', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const prev = cfg.modelConfig || {}
  const next: ModelConfig = {
    name: incoming.name ?? prev.name,
    provider: incoming.provider ?? prev.provider,
    baseUrl: incoming.baseUrl ?? prev.baseUrl,
    temperature: typeof incoming.temperature === 'number' ? incoming.temperature : prev.temperature,
    thinking: typeof incoming.thinking === 'boolean' ? incoming.thinking : (prev.thinking ?? false),
    extraBody: typeof incoming.extraBody === 'string' && incoming.extraBody.trim() ? incoming.extraBody.trim() : (prev.extraBody ?? ''),
    apiKey: typeof incoming.apiKey === 'string' && incoming.apiKey !== ''
      ? encrypt(incoming.apiKey, req.user!.id)
      : (prev.apiKey || '')
  }
  cfg.modelConfig = next
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true, apiKey: maskKey(incoming.apiKey) })
}))

// 博查
router.put('/bocha', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const prev = cfg.bochaConfig || {}
  const next: BochaConfig = {
    baseUrl: incoming.baseUrl ?? prev.baseUrl ?? 'https://api.bochaai.com',
    apiKey: typeof incoming.apiKey === 'string' && incoming.apiKey !== ''
      ? encrypt(incoming.apiKey, req.user!.id)
      : (prev.apiKey || '')
  }
  cfg.bochaConfig = next
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true, apiKey: maskKey(incoming.apiKey) })
}))

// PostgreSQL（HITL checkpointer 持久化）
router.put('/postgres', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const prev = cfg.postgresConfig || {}
  const next: PostgresConfig = {
    host: incoming.host ?? prev.host,
    port: Number.isFinite(Number(incoming.port)) && Number(incoming.port) > 0 ? Number(incoming.port) : (prev.port ?? 5432),
    user: incoming.user ?? prev.user,
    database: incoming.database ?? prev.database,
    password: typeof incoming.password === 'string' && incoming.password !== ''
      ? encrypt(incoming.password, req.user!.id)
      : (prev.password || '')
  }
  cfg.postgresConfig = next
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true, password: maskKey(incoming.password) })
}))

/** 用传入或已存的配置测试 PostgreSQL 连通性（PostgresSaver 建表权限） */
router.post('/postgres/test', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const prev = cfg.postgresConfig || {}
  const conf: PostgresConfig = {
    host: String(incoming.host ?? prev.host ?? ''),
    port: Number(incoming.port ?? prev.port ?? 5432),
    user: String(incoming.user ?? prev.user ?? ''),
    password: typeof incoming.password === 'string' && incoming.password !== ''
      ? incoming.password
      : (prev.password ? decrypt(prev.password, req.user!.id) : ''),
    database: String(incoming.database ?? prev.database ?? '')
  }
  if (!conf.host || !conf.user || !conf.database) {
    throw new HttpError(400, 'BAD_REQUEST', '请完整填写主机、账号与数据库名')
  }
  const { testPostgresConnection } = await import('../../services/PostgresCheckpointer')
  try {
    await testPostgresConnection(conf)
    res.json({ ok: true })
  } catch (e: any) {
    throw new HttpError(400, 'PG_CONNECT_FAILED', e?.message || '连接失败')
  }
}))

// 向量模型（记忆功能 embedding）
router.put('/embedding', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const prev = cfg.embeddingConfig || {}
  const next: EmbeddingConfig = {
    name: incoming.name ?? prev.name,
    provider: incoming.provider ?? prev.provider,
    baseUrl: incoming.baseUrl ?? prev.baseUrl,
    dimensions: Number.isFinite(Number(incoming.dimensions)) && Number(incoming.dimensions) > 0 ? Number(incoming.dimensions) : (prev.dimensions ?? 1024),
    apiKey: typeof incoming.apiKey === 'string' && incoming.apiKey !== ''
      ? encrypt(incoming.apiKey, req.user!.id)
      : (prev.apiKey || '')
  }
  cfg.embeddingConfig = next
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true, apiKey: maskKey(incoming.apiKey) })
}))

/** 用传入或已存的配置测试向量模型（发一次真实 embedding 请求并返回维度） */
router.post('/embedding/test', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const incoming = req.body || {}
  const prev = cfg.embeddingConfig || {}
  const conf: EmbeddingConfig = {
    name: String(incoming.name ?? prev.name ?? ''),
    provider: incoming.provider ?? prev.provider,
    baseUrl: String(incoming.baseUrl ?? prev.baseUrl ?? ''),
    apiKey: typeof incoming.apiKey === 'string' && incoming.apiKey !== ''
      ? incoming.apiKey
      : (prev.apiKey ? decrypt(prev.apiKey, req.user!.id) : '')
  }
  if (!conf.name || !conf.baseUrl || !conf.apiKey) {
    throw new HttpError(400, 'BAD_REQUEST', '请完整填写模型名称、接口地址与密钥')
  }
  const { EmbeddingService } = await import('../../services/EmbeddingService')
  try {
    const dims = await EmbeddingService.probe(conf, req.user!.id)
    res.json({ ok: true, dimensions: dims })
  } catch (e: any) {
    throw new HttpError(400, 'EMBED_TEST_FAILED', e?.message || '向量模型测试失败')
  }
}))

// ==================== 微信 ClawBot（免配置扫码绑定） ====================

/** 构建当前用户已解密凭据的 ClawBot 服务实例 */
function makeClawBotService(cfg: UserConfig, userId: number): WeChatClawBotService {
  const wc = cfg.wechatConfig || {}
  return new WeChatClawBotService({
    ...wc,
    botToken: wc.botToken ? decrypt(wc.botToken, userId) : ''
  })
}

// 绑定第一步：获取微信登录二维码（WeKnora 开放接口，无参数免配置）
router.post('/wechat/bind/qrcode', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const svc = makeClawBotService(cfg, req.user!.id)
  const result = await svc.fetchQrCode()
  res.json({ qrcodeUrl: result.qrcodeUrl, qrcode: result.qrcode })
}))

// 绑定第二步：轮询扫码状态（长轮询透传）；confirmed 时凭据加密落库并启动消息轮询
router.post('/wechat/bind/status', asyncHandler(async (req: AuthedRequest, res) => {
  const { qrcode } = req.body || {}
  if (!qrcode || typeof qrcode !== 'string') throw new HttpError(400, 'BAD_REQUEST', '缺少 qrcode 参数')
  const cfg = await getOrCreateConfig(req.user!.id)
  const svc = makeClawBotService(cfg, req.user!.id)
  const result = await svc.pollQrStatus(qrcode)

  if (result.status === 'confirmed' && result.credentials?.botToken) {
    const prev = cfg.wechatConfig || {}
    cfg.wechatConfig = {
      ...prev,
      bound: true,
      botToken: encrypt(result.credentials.botToken, req.user!.id),
      ilinkBotId: result.credentials.ilinkBotId,
      ilinkUserId: result.credentials.ilinkUserId,
      apiBaseUrl: result.baseUrl || prev.apiBaseUrl,
      cursor: '',
      boundAt: new Date().toISOString()
    }
    await AppDataSource.getRepository(UserConfig).save(cfg)
    // 绑定成功 → 启动该用户的微信消息轮询（交给小助理处理并回发）
    onClawBotBound(req.user!.id).catch(() => {})
    res.json({ status: result.status, bound: true, boundAt: cfg.wechatConfig.boundAt })
    return
  }
  res.json({ status: result.status, bound: false })
}))

// 解绑：停止消息轮询并清空绑定凭据
router.post('/wechat/unbind', asyncHandler(async (req: AuthedRequest, res) => {
  stopClawBotPoller(req.user!.id)
  const cfg = await getOrCreateConfig(req.user!.id)
  cfg.wechatConfig = {
    ...(cfg.wechatConfig || {}),
    bound: false,
    botToken: '',
    ilinkBotId: '',
    ilinkUserId: '',
    apiBaseUrl: '',
    cursor: '',
    boundAt: undefined
  }
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true })
}))

// 主题/语言默认项
router.put('/ui', asyncHandler(async (req: AuthedRequest, res) => {
  const cfg = await getOrCreateConfig(req.user!.id)
  const { themeDefault, themeFollowTime, langDefault } = req.body || {}
  if (themeDefault !== undefined) cfg.themeDefault = themeDefault
  if (themeFollowTime !== undefined) cfg.themeFollowTime = Boolean(themeFollowTime)
  if (langDefault !== undefined) cfg.langDefault = langDefault
  await AppDataSource.getRepository(UserConfig).save(cfg)
  res.json({ ok: true })
}))

/**
 * 内部工具：解密当前用户的模型/博查/微信密钥（供 assistant 模块调用）。
 * @param opts.chatModelId 指定 chat 模型（会话级模型优先）；缺省用 lastChatModelId → 列表第一个 chat → 旧 modelConfig
 * model：优先取 modelPrefs.lastChatModelId 指向的模型，否则列表第一个 chat，
 * 均无则回退旧 modelConfig（兼容）。embedding 同理取列表第一个 embedding。
 */
export async function getDecryptedSecrets(userId: number, opts?: { chatModelId?: string | null }) {
  const cfg = await getOrCreateConfig(userId)
  const items = resolveModelItems(cfg)
  const prefs = cfg.modelPrefs || {}
  const chatModel =
    (opts?.chatModelId && findModel(items, opts.chatModelId, userId)) ||
    (prefs.lastChatModelId && findModel(items, prefs.lastChatModelId, userId)) ||
    items.filter((m) => m.type === 'chat').map((m) => findModel(items, m.id, userId)).find(Boolean) ||
    null
  const embModel = items.filter((m) => m.type === 'embedding').map((m) => findModel(items, m.id, userId)).find(Boolean) || null
  return {
    model: (chatModel
      ? { name: chatModel.name, provider: chatModel.provider as any, apiKey: chatModel.apiKey, baseUrl: chatModel.baseUrl, temperature: chatModel.temperature, thinking: chatModel.thinking, extraBody: chatModel.extraBody }
      : { ...(cfg.modelConfig || {}), apiKey: cfg.modelConfig?.apiKey ? decrypt(cfg.modelConfig.apiKey, userId) : '' }) as ModelConfig,
    bocha: {
      ...(cfg.bochaConfig || {}),
      apiKey: cfg.bochaConfig?.apiKey ? decrypt(cfg.bochaConfig.apiKey, userId) : ''
    } as BochaConfig,
    wechat: {
      ...(cfg.wechatConfig || {}),
      botToken: cfg.wechatConfig?.botToken ? decrypt(cfg.wechatConfig.botToken, userId) : ''
    } as WeChatConfig,
    postgres: {
      ...(cfg.postgresConfig || {}),
      password: cfg.postgresConfig?.password ? decrypt(cfg.postgresConfig.password, userId) : ''
    } as PostgresConfig,
    embedding: (embModel
      ? { name: embModel.name, provider: embModel.provider as any, apiKey: embModel.apiKey, baseUrl: embModel.baseUrl, dimensions: embModel.dimensions }
      : { ...(cfg.embeddingConfig || {}), apiKey: cfg.embeddingConfig?.apiKey ? decrypt(cfg.embeddingConfig.apiKey, userId) : '' }) as EmbeddingConfig,
    /** 记忆流水线专用模型（modelPrefs.memoryModelId；缺省取列表第一个 chat，再退 model） */
    memoryModel: (() => {
      const m = (prefs.memoryModelId && findModel(items, prefs.memoryModelId, userId)) || chatModel
      if (!m) return null
      return { name: m.name, provider: m.provider as any, apiKey: m.apiKey, baseUrl: m.baseUrl, temperature: m.temperature, thinking: m.thinking, extraBody: m.extraBody } as ModelConfig
    })(),
    /** 知识库切片专用模型（modelPrefs.knowledgeModelId；缺省退 memoryModel → model） */
    knowledgeModel: (() => {
      const m = (prefs.knowledgeModelId && findModel(items, prefs.knowledgeModelId, userId)) || (prefs.memoryModelId && findModel(items, prefs.memoryModelId, userId)) || chatModel
      if (!m) return null
      return { name: m.name, provider: m.provider as any, apiKey: m.apiKey, baseUrl: m.baseUrl, temperature: m.temperature, thinking: m.thinking, extraBody: m.extraBody } as ModelConfig
    })(),
    workDir: cfg.workDir || null
  }
}

export { router as configRouter }
