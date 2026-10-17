/**
 * 应用内提醒队列（内存版）：
 * 调度器触发提醒时入队，前端轮询拉取后展示左下角提醒卡片。
 * - 每个用户独立队列；拉取即清空（读走所有待展示事件）
 * - 队列只在应用运行期间存在，重启后不保留（提醒已通过系统通知/卡片展示过）
 * - 事件同时落库到消息中心（message 表，带 messageId 便于卡片操作同步处理消息）
 * - 上限保护：单用户堆积超过 50 条时丢弃最旧的
 */

import { createMessage } from './MessageService'

export interface RemindEvent {
  id: string
  /** 关联的消息中心消息 id（卡片「关闭/不再提醒」时同步标记已读） */
  messageId: number | null
  todoId: number
  userId: number
  /** 提醒类型：start=开始提醒 end=结束提醒 deadline-start/deadline-end=到点 */
  kind: 'start' | 'end' | 'deadline-start' | 'deadline-end'
  title: string
  body: string
  firedAt: string
}

const queues = new Map<number, RemindEvent[]>()
const MAX_PER_USER = 50
let seq = 0

/** 入队一条提醒事件（同时落库消息中心） */
export async function pushRemindEvent(e: Omit<RemindEvent, 'id' | 'firedAt' | 'messageId'>): Promise<RemindEvent> {
  // 落库消息中心（todo 分类，关联待办 id）
  const msg = await createMessage({
    userId: e.userId,
    category: 'todo',
    title: e.title,
    content: e.body,
    refType: 'todo',
    refId: e.todoId
  })
  const event: RemindEvent = {
    ...e,
    messageId: msg?.id ?? null,
    id: `${Date.now()}-${++seq}`,
    firedAt: new Date().toISOString()
  }
  const q = queues.get(e.userId) || []
  q.push(event)
  if (q.length > MAX_PER_USER) q.splice(0, q.length - MAX_PER_USER)
  queues.set(e.userId, q)
  return event
}

/** 拉取并清空指定用户的提醒事件 */
export function drainRemindEvents(userId: number): RemindEvent[] {
  const q = queues.get(userId)
  if (!q || q.length === 0) return []
  queues.set(userId, [])
  return q
}
