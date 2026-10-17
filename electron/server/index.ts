import express from 'express'
import cors from 'cors'
import { json } from 'body-parser'
import { env } from './env'
import { ensureDataSource } from './data-source'
import { errorHandler, HttpError } from './middleware/error'
import { authRequired, AuthedRequest } from './middleware/auth'
import { authRouter } from './modules/auth/auth.router'
import { todoRouter } from './modules/todo/todo.router'
import { notesRouter } from './modules/notes/notes.router'
import { configRouter } from './modules/config/config.router'
import { assistantRouter } from './modules/assistant/assistant.router'
import { messagesRouter } from './modules/messages/messages.router'
import { memoriesRouter } from './modules/memories/memories.router'
import { knowledgeRouter } from './modules/knowledge/knowledge.router'
import { startClawBotPollers } from './services/ClawBotPoller'
import { startRemindScheduler, setRemindNotifier } from './services/RemindScheduler'
import { drainRemindEvents } from './services/RemindQueue'
import { setWorkDir } from '../preload-ipc'

/** 主进程注入系统通知桥（调度器触发提醒时弹 Electron Notification） */
export function bindRemindNotifier(fn: (userId: number, title: string, body: string) => void) {
  setRemindNotifier(fn)
}

export async function startEmbeddedServer() {
  await ensureDataSource()

  const app = express()
  // 允许任意本地端口（dev server 端口可能因占用自动递增）
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) }))
  app.use(json({ limit: '20mb' }))

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

  // 应用内提醒事件：前端轮询拉取（拉取即清空），展示左下角提醒卡片
  app.get('/reminders', authRequired, (req: AuthedRequest, res) => {
    res.json({ list: drainRemindEvents(req.user?.id ?? 0) })
  })

  app.use('/auth', authRouter)
  app.use('/todos', todoRouter)
  app.use('/notes', notesRouter)
  app.use('/config', configRouter)
  app.use('/assistant', assistantRouter)
  app.use('/messages', messagesRouter)
  app.use('/memories', memoriesRouter)
  app.use('/knowledge', knowledgeRouter)

  // 微信 ClawBot：恢复已绑定用户的消息轮询（消息交小助理处理后回发）
  startClawBotPollers().catch(() => {})

  // 待办提醒调度器：分钟级扫描开启提醒的待办
  startRemindScheduler()

  app.use(() => {
    throw new HttpError(404, 'NOT_FOUND', '接口不存在')
  })
  app.use(errorHandler as any)

  return new Promise<void>((resolve) => {
    app.listen(env.server.port, env.server.host, () => {
      console.log(`[server] listening on http://${env.server.host}:${env.server.port}`)
      resolve()
    })
  })
}

export function applyWorkDir(dir: string | undefined) {
  setWorkDir(dir)
}
