import { http } from './http'

export interface ChatSessionDTO {
  id: number
  title: string
  /** 会话来源：app = 前端对话，wxclaw = 微信 ClawBot 渠道（只读） */
  source?: string
  /** 记忆开关（仅新会话可设置） */
  memoryEnabled?: boolean
  /** 本会话使用的 chat 模型 id */
  modelId?: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatMsgDTO {
  role: 'user' | 'assistant'
  content: string
  attachments?: { name: string; relPath: string; size: number }[]
  thought?: string
  tools?: { tool: string; input?: any; output?: any }[]
  timeline?: { type: 'reasoning' | 'content' | 'tool'; text?: string; tool?: string; input?: any; output?: any; running?: boolean; runId?: string }[]
  usage?: { input: number; output: number }
  /** HITL 破坏性工具确认记录（含最终决策） */
  hitl?: { tool: string; input?: any; prompt: string; decision?: 'approve' | 'reject' | 'ignore' }
  at: string
}

export interface SkillDTO {
  name: string
  description: string
  dirName: string
  relPath: string
}

/** chat 模型选项（输入框模型选择用） */
export interface ChatModelOption {
  id: string
  name: string
  provider?: string
  baseUrl?: string
}

export const assistantApi = {
  listSessions: () => http.get<{ list: ChatSessionDTO[] }>('/assistant/sessions').then((r) => r.data.list),
  getSession: (id: number) =>
    http.get<{ session: { id: number; title: string; source?: string; memoryEnabled?: boolean; modelId?: string | null; messages: ChatMsgDTO[]; updatedAt: string } }>(`/assistant/sessions/${id}`).then((r) => r.data.session),
  deleteSession: (id: number) => http.delete(`/assistant/sessions/${id}`).then((r) => r.data),
  stop: (sessionId: number) => http.post('/assistant/stop', { sessionId }).then((r) => r.data),
  /** 可选 chat 模型列表 + 默认选中（最近使用） */
  chatModels: () =>
    http.get<{ chatModels: ChatModelOption[]; selected: string }>('/assistant/models').then((r) => r.data),
  /** HITL 确认：对破坏性工具（删除待办等）的选择，resume 智能体继续 */
  confirm: (sessionId: number, decision: 'approve' | 'reject' | 'ignore') =>
    http.post('/assistant/confirm', { sessionId, decision }).then((r) => r.data),
  /** 获取本会话上传目录（不存在则创建） */
  ensureUploadDir: (sessionId: number | null) =>
    http.get<{ relPath: string }>('/assistant/upload-dir', { params: sessionId ? { sessionId } : {} }).then((r) => r.data.relPath),
  upload: (file: File, sessionId: number | null) => {
    const fd = new FormData()
    fd.append('file', file)
    return http
      .post(`/assistant/upload${sessionId ? `?sessionId=${sessionId}` : ''}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000
      })
      .then((r) => r.data as { name: string; relPath: string; size: number })
  },
  /** 已安装技能清单 */
  listSkills: () => http.get<{ list: SkillDTO[] }>('/assistant/skills').then((r) => r.data.list),
  /** 上传技能包（.zip 或 SKILL.md） */
  uploadSkill: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http
      .post('/assistant/skills/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000
      })
      .then((r) => r.data.skill as SkillDTO)
  },
  deleteSkill: (dirName: string) => http.delete(`/assistant/skills/${encodeURIComponent(dirName)}`).then((r) => r.data)
}
