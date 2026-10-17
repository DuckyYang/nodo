import { http } from './http'

/** 消息分类：todo=待办消息 assistant=小助理消息 */
export type MessageCategory = 'todo' | 'assistant'

export interface MessageDTO {
  id: number
  category: MessageCategory
  title: string
  content: string
  read: boolean
  refType?: string | null
  refId?: number | null
  createdAt: string
}

export interface MessageQuery {
  /** unread=未读 read=已读（不传=全部） */
  read?: 'unread' | 'read'
  category?: MessageCategory
  keyword?: string
  take?: number
  skip?: number
}

export const messageApi = {
  /** 消息列表（筛选 + 检索 + 分页，时间倒序） */
  list: (q: MessageQuery = {}) =>
    http.get<{ list: MessageDTO[]; total: number }>('/messages', { params: q }).then((r) => r.data),
  /** 未读数（红点） */
  unreadCount: () =>
    http.get<{ count: number }>('/messages/unread').then((r) => r.data.count),
  /** 标记已读 */
  markRead: (id: number) =>
    http.put<{ message: MessageDTO }>(`/messages/${id}/read`).then((r) => r.data.message),
  /** 全部已读（可带 category 只清某一类） */
  markAllRead: (category?: MessageCategory) =>
    http.put('/messages/read-all', { category }).then((r) => r.data),
  /** 清除已读消息（可带 category） */
  clearRead: (category?: MessageCategory) =>
    http.delete<{ ok: boolean }>('/messages/read', { data: { category } }).then((r) => r.data)
}
