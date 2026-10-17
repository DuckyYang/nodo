import { AppDataSource } from '../data-source'
import { Message, type MessageCategory } from '../entities/Message'

/**
 * 消息中心服务：统一的消息落库入口。
 * 各业务（待办提醒调度器、小助理等）调用 createMessage 后，
 * 消息即可在消息中心被检索/筛选/标记已读。
 */

export interface CreateMessageInput {
  userId: number
  category: MessageCategory
  title: string
  content: string
  refType?: string | null
  refId?: number | null
}

/** 落库一条消息（失败静默：消息中心是旁路能力，不影响主流程） */
export async function createMessage(input: CreateMessageInput): Promise<Message | null> {
  try {
    const repo = AppDataSource.getRepository(Message)
    const m = repo.create({
      userId: input.userId,
      category: input.category,
      title: String(input.title).slice(0, 200),
      content: String(input.content),
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      read: false
    })
    await repo.save(m)
    return m
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.warn('[message] create failed:', err)
    return null
  }
}
