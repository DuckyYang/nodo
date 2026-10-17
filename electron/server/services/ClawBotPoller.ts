/**
 * ClawBot 消息轮询服务：绑定成功后自动长轮询微信消息，
 * 交给小助理（deepagents）处理，并把最终总结回发给微信用户。
 *
 * 设计：
 * - 每个已绑定用户一个轮询循环（getupdates 长轮询，~35s/次）
 * - 消息处理走 runDeepAgent：与前端 /chat 完全同构的归档链路
 *   （写入 ChatSession，历史会话可见），但固定开启：
 *     · 全部已安装技能（listSkills 全量激活）
 *     · 联网检索（webSearchEnabled: true）
 *     · 笔记 + 待办 全部工具（runDeepAgent 默认全挂）
 * - 会话隔离：微信渠道使用独立 ChatSession（title 前缀「微信」），
 *   同一会话连续多轮保持上下文
 * - 游标（get_updates_buf）持久化到 WeChatConfig.cursor，重启续传
 * - errcode -14（会话过期）：停止轮询、标记解绑，等待用户重新扫码
 */
import { AppDataSource } from '../data-source'
import { UserConfig, WeChatConfig } from '../entities/UserConfig'
import { ChatSession, type ChatMsgRecord } from '../entities/ChatSession'
import { User } from '../entities/User'
import { WeChatClawBotService, type IlinkIncomingMessage } from './WeChatClawBotService'
import { listSkills } from './SkillService'
import { getDecryptedSecrets } from '../modules/config/config.router'
import { runDeepAgent } from './DeepAgentService'
import { emitWxEvent } from './WxEventBus'

/** 每用户轮询循环句柄 */
const pollers = new Map<number, { stop: () => void }>()

/** 微信渠道会话标题前缀（与前端会话区分） */
const WX_SESSION_TITLE_PREFIX = '微信'

/** 微信渠道每用户固定会话（多轮共享上下文） */
async function getWxSession(userId: number, firstMessage: string): Promise<ChatSession> {
  const repo = AppDataSource.getRepository(ChatSession)
  // 复用最近的「微信」会话（30 天内），否则新建
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const existing = await repo
    .createQueryBuilder('s')
    .where('s.userId = :userId', { userId })
    .andWhere('s.title LIKE :prefix', { prefix: `${WX_SESSION_TITLE_PREFIX}%` })
    .andWhere('s.source = :source', { source: 'wxclaw' })
    .andWhere('s.updatedAt > :since', { since: monthAgo })
    .orderBy('s.updatedAt', 'DESC')
    .getOne()
  if (existing) return existing
  const s = new ChatSession()
  s.userId = userId
  s.title = `${WX_SESSION_TITLE_PREFIX} · ${firstMessage.replace(/\s+/g, ' ').slice(0, 10)}`
  s.source = 'wxclaw'
  s.messages = []
  return repo.save(s)
}

/** 读取用户微信配置（解密 botToken） */
async function loadWxConfig(userId: number): Promise<WeChatConfig | null> {
  const { decrypt } = await import('../utils/SecretStore')
  const cfg = await AppDataSource.getRepository(UserConfig).findOne({ where: { userId } })
  const wc = cfg?.wechatConfig
  if (!wc || !wc.bound) return null
  return { ...wc, botToken: wc.botToken ? decrypt(wc.botToken, userId) : '' }
}

/** 保存微信配置增量（含游标持久化） */
async function saveWxConfig(userId: number, patch: Partial<WeChatConfig>): Promise<void> {
  const repo = AppDataSource.getRepository(UserConfig)
  const cfg = await repo.findOne({ where: { userId } })
  if (!cfg) return
  cfg.wechatConfig = { ...(cfg.wechatConfig || {}), ...patch }
  await repo.save(cfg)
}

/** 处理一条微信消息：归档 → 小助理全能力处理 → 回发最终总结 */
async function handleMessage(userId: number, svc: WeChatClawBotService, msg: IlinkIncomingMessage): Promise<void> {
  if (!msg.text.trim()) {
    // 语音消息没有微信转写文本（用户未开启「语音转文字」）：
    // 提示引导，不再静默丢弃；其他非文本类型（图片/文件/视频）暂不支持
    if (msg.voice) {
      await svc
        .sendText(msg.fromUserId, msg.contextToken, '暂无法直接收听语音。请在微信长按该语音选择「转文字」后再发一次，或直接输入文字消息。')
        .catch(() => {})
    }
    return
  }

  const secrets = await getDecryptedSecrets(userId)
  if (!secrets.model.apiKey) {
    await svc.sendText(msg.fromUserId, msg.contextToken, '小助理未配置模型 API Key，请先在配置中心完成模型配置。').catch(() => {})
    return
  }

  // 会话归档：用户消息落库
  const repo = AppDataSource.getRepository(ChatSession)
  const session = await getWxSession(userId, msg.text)
  const userMsg: ChatMsgRecord = { role: 'user', content: msg.text, at: new Date().toISOString() }
  session.messages = [...(session.messages || []), userMsg]
  await repo.save(session)
  // 实时推送：前端正打开该微信会话时立即显示用户消息
  emitWxEvent(userId, 'wx_message', { sessionId: session.id, text: msg.text })

  // ClawBot 渠道激活全部技能 + 联网检索
  const allSkills = secrets.workDir ? await listSkills(secrets.workDir).catch(() => []) : []

  let reply = ''
  await runDeepAgent({
    userId,
    userName: (await AppDataSource.getRepository(User).findOne({ where: { id: userId } }))?.name || undefined,
    message: msg.text,
    sessionId: session.id,
    attachments: [],
    // 全部已安装技能激活
    activeSkills: allSkills.map((s) => s.dirName),
    // 固定开启联网检索
    webSearchEnabled: true,
    threadKey: `wx-u${userId}`,
    history: (session.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant'),
    secrets,
    onToken: (t) => emitWxEvent(userId, 'wx_token', { sessionId: session.id, v: t }),
    onThought: (t) => emitWxEvent(userId, 'wx_thought', { sessionId: session.id, v: t }),
    onTool: (info) => emitWxEvent(userId, 'wx_tool', { sessionId: session.id, ...info }),
    // 微信渠道无法交互确认（HITL）：自动拒绝破坏性操作，回复中说明原因
    onHitl: async (task): Promise<'approve' | 'reject' | 'ignore'> => {
      emitWxEvent(userId, 'wx_hitl_rejected', { sessionId: session.id, tool: task.tool, prompt: task.prompt })
      return 'reject'
    },
    onReply: (m) => {
      reply = m.content
      // 归档回复（与 /chat 同构，前端历史会话可见）
      const rec: ChatMsgRecord = { ...m, at: new Date().toISOString() }
      repo.findOne({ where: { id: session.id } }).then((fresh) => {
        if (!fresh) return
        fresh.messages = [...(fresh.messages || []), rec]
        repo.save(fresh).catch(() => {})
      }).catch(() => {})
    },
    onDone: () => {
      emitWxEvent(userId, 'wx_done', { sessionId: session.id, usage: undefined })
    },
    onError: (e) => {
      reply = `处理失败：${e.message}`
      emitWxEvent(userId, 'wx_error', { sessionId: session.id, message: e.message })
    }
  })

  // 回发最终总结（失败静默，下轮消息仍可处理）
  if (reply.trim()) {
    await svc.sendText(msg.fromUserId, msg.contextToken, reply).catch(() => {})
  }
}

/** 启动单用户的轮询循环 */
async function startPoller(userId: number): Promise<void> {
  if (pollers.has(userId)) return

  const ctrl = { stop: false }
  pollers.set(userId, { stop: () => { ctrl.stop = true } })

  ;(async () => {
    while (!ctrl.stop) {
      const wc = await loadWxConfig(userId)
      if (!wc || !wc.botToken) break // 已解绑
      const svc = new WeChatClawBotService(wc)
      try {
        const { msgs, cursor, sessionExpired } = await svc.getUpdates(wc.cursor || '')
        if (ctrl.stop) return
        if (sessionExpired) {
          // 会话过期：标记解绑并停止轮询，等待重新扫码
          await saveWxConfig(userId, { bound: false, botToken: '', cursor: '' })
          break
        }
        if (cursor && cursor !== wc.cursor) await saveWxConfig(userId, { cursor })
        for (const msg of msgs) {
          if (ctrl.stop) return
          await handleMessage(userId, svc, msg)
        }
      } catch {
        // 网络抖动等：退避后继续
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  })().finally(() => pollers.delete(userId))
}

/** 启动所有已绑定用户的轮询（服务启动 / 新绑定成功时调用） */
export async function startClawBotPollers(): Promise<void> {
  const repo = AppDataSource.getRepository(UserConfig)
  const all = await repo.find()
  for (const cfg of all) {
    if (cfg.wechatConfig?.bound && cfg.wechatConfig?.botToken) {
      startPoller(cfg.userId).catch(() => {})
    }
  }
}

/** 绑定成功后启动该用户轮询 */
export async function onClawBotBound(userId: number): Promise<void> {
  await startPoller(userId)
}

/** 解绑时停止该用户轮询 */
export function stopClawBotPoller(userId: number): void {
  pollers.get(userId)?.stop()
  pollers.delete(userId)
}
