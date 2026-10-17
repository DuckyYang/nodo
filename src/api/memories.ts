import { http } from './http'

/** 记忆类别：事实知识 / 行为习惯 / 性格偏好 / 操作经验 */
export type MemoryCategory = 'fact' | 'behavior' | 'preference' | 'experience'

/** 记忆归属：user = 用户记忆，assistant = 小助理记忆 */
export type MemoryKind = 'user' | 'assistant'

export interface MemoryDTO {
  id: number
  kind: MemoryKind
  content: string
  category?: MemoryCategory | string | null
  /** 可信度 0-1 */
  confidence?: number | null
  sourceSession?: number | null
  createdAt: string
  updatedAt: string
  /** 检索结果附带的相关性得分（0-1，越大越相关） */
  score?: number
}

/** 记忆流水线进度日志 */
export interface MemoryLogDTO {
  at: string
  runId: string
  sessionId: number
  /** start / extract / search / synthesize / done / error / skip */
  step: string
  message: string
}

export interface MemoryModelDTO {
  chatModels: { id: string; name: string; provider?: string; baseUrl?: string }[]
  selected: string
}

export const memoriesApi = {
  /** 记忆列表（时间倒序，支持关键词过滤） */
  list: (kind: MemoryKind, keyword?: string) =>
    http.get<{ list: MemoryDTO[] }>('/memories', { params: { kind, keyword: keyword || undefined } }).then((r) => r.data.list),
  /** 相关性检索 */
  search: (q: string, kind?: MemoryKind, topK = 10) =>
    http.get<{ list: MemoryDTO[] }>('/memories/search', { params: { q, kind, topK } }).then((r) => r.data.list),
  /** 修改记忆（后端重新向量化） */
  update: (kind: MemoryKind, id: number, p: { content?: string; category?: string; confidence?: number }) =>
    http.put<{ memory: MemoryDTO }>(`/memories/${id}`, p, { params: { kind } }).then((r) => r.data.memory),
  /** 删除记忆 */
  remove: (kind: MemoryKind, id: number) =>
    http.delete(`/memories/${id}`, { params: { kind } }).then((r) => r.data),
  /** 流水线进度日志（clear=1 清空） */
  logs: (clear = false) =>
    http.get<{ list: MemoryLogDTO[] }>('/memories/logs', { params: clear ? { clear: 1 } : {} }).then((r) => r.data.list),
  /** 记忆模型配置读取 */
  getModel: () => http.get<MemoryModelDTO>('/memories/model').then((r) => r.data),
  /** 记忆模型配置保存 */
  setModel: (modelId: string) => http.put('/memories/model', { modelId }).then((r) => r.data)
}
