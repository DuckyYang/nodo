/**
 * 微信渠道事件总线：ClawBotPoller → 前端实时订阅。
 *
 * 事件流（SSE 推送给正打开微信会话的前端页面）：
 * - wx_message  { sessionId, text }                    用户从微信发来的消息（归档前）
 * - wx_token    { sessionId, v }                       小助理回复内容增量
 * - wx_thought  { sessionId, v }                       思考过程增量
 * - wx_tool     { sessionId, tool, input?, output?, runId? } 工具调用
 * - wx_done     { sessionId, usage }                   回复完成
 * - wx_error    { sessionId, message }                 处理出错
 *
 * 按 userId 隔离订阅者；同一用户多页面（窗口）同时订阅时全部收到。
 */

export interface WxSseEvent {
  event: string
  data: any
}

type Listener = (e: WxSseEvent) => void

/** userId → 订阅者集合 */
const listeners = new Map<number, Set<Listener>>()

/** 订阅（返回取消函数） */
export function subscribeWxEvents(userId: number, fn: Listener): () => void {
  let set = listeners.get(userId)
  if (!set) {
    set = new Set()
    listeners.set(userId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (!set!.size) listeners.delete(userId)
  }
}

/** 广播事件给该用户的所有订阅者 */
export function emitWxEvent(userId: number, event: string, data: any): void {
  const set = listeners.get(userId)
  if (!set) return
  for (const fn of set) {
    try { fn({ event, data }) } catch { /* 单个订阅者异常不影响其他 */ }
  }
}

/** 判断用户是否有活跃订阅（无订阅时轮询侧可跳过细粒度事件，节省开销） */
export function hasWxSubscribers(userId: number): boolean {
  return (listeners.get(userId)?.size || 0) > 0
}
