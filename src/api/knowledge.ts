import { http } from './http'

/** 知识来源：file = 用户上传文件；chat = 小助理对话沉淀 */
export type KnowledgeSource = 'file' | 'chat'

/** 知识条目状态：pending → parsing → chunking → embedding → done / error */
export type KnowledgeStatus = 'pending' | 'parsing' | 'chunking' | 'embedding' | 'done' | 'error'

export interface KnowledgeDocDTO {
  id: number
  source: KnowledgeSource
  title: string
  fileName?: string | null
  relPath?: string | null
  md5?: string | null
  size?: number | null
  status: KnowledgeStatus | string
  statusDetail?: string | null
  chunkCount: number
  charCount: number
  sourceSession?: number | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunkDTO {
  id: number
  docId: number
  seq: number
  content: string
  charCount: number
  createdAt: string
}

export const knowledgeApi = {
  /** 知识列表（时间倒序，关键词过滤标题/文件名） */
  list: (keyword?: string) =>
    http.get<{ list: KnowledgeDocDTO[] }>('/knowledge', { params: { keyword: keyword || undefined } }).then((r) => r.data.list),
  /** 知识详情（含全部切片） */
  detail: (id: number) =>
    http.get<{ doc: KnowledgeDocDTO; chunks: KnowledgeChunkDTO[] }>(`/knowledge/${id}`).then((r) => r.data),
  /** 上传文件（5M 内 docx/xlsx/pdf/md/txt）；重复文件返回 duplicate=true */
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http
      .post<{ duplicate: boolean; doc: KnowledgeDocDTO }>('/knowledge/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000
      })
      .then((r) => r.data)
  },
  /** 重试处理（失败/中断后重建切片） */
  retry: (id: number) => http.post(`/knowledge/${id}/retry`).then((r) => r.data),
  /** 删除知识（连带切片与源文件） */
  remove: (id: number) => http.delete(`/knowledge/${id}`).then((r) => r.data),
  /** 知识检索（调试/测试） */
  search: (q: string, topK = 5) =>
    http.get<{ list: { docId: number; docTitle: string; source: string; seq: number; content: string; score: number }[] }>(
      '/knowledge/search',
      { params: { q, topK } }
    ).then((r) => r.data.list),
  /** 切片模型配置读取 */
  getModel: () => http.get<{ chatModels: { id: string; name: string; provider?: string; baseUrl?: string }[]; selected: string }>('/knowledge/model').then((r) => r.data),
  /** 切片模型配置保存 */
  setModel: (modelId: string) => http.put('/knowledge/model', { modelId }).then((r) => r.data),
  /** 知识抽取流水线日志（前端轮询兜底 SSE 终态丢失） */
  logs: () =>
    http.get<{ logs: { at: string; runId: string; sessionId: number; step: string; message: string }[] }>('/knowledge/logs').then((r) => r.data.logs)
}
