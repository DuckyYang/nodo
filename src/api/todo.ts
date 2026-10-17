import { http } from './http'

export interface TodoGroupDTO { id: number; name: string; sort: number; pinned: boolean; createdAt: string }
/** 待办状态：not_started=未开始 in_progress=进行中 completed=已完成（已延期由 planEnd 实时推导，不落库） */
export type TodoStatus = 'not_started' | 'in_progress' | 'completed'
/**
 * 提醒规则：
 * startBeforeMinutes = 开始提醒（计划开始前 x 分钟，≥3）
 * endBeforeMinutes   = 结束提醒（计划完成前 x 分钟，≥3）
 * repeatEnabled + repeatIntervalMinutes（y）：窗口 [目标-x, 目标] 内每隔 y 分钟重复（1 ≤ y ≤ x）
 */
export interface RemindRule {
  startBeforeMinutes?: number
  endBeforeMinutes?: number
  repeatEnabled: boolean
  repeatIntervalMinutes?: number
}
/** 编辑器表单态：额外带两个开关（提交时剥离，不持久化） */
export interface RemindRuleForm extends RemindRule {
  startEnabled: boolean
  endEnabled: boolean
}
/** 待办步骤（子任务） */
export interface TodoStepDTO {
  id: number
  todoId: number
  content: string
  done: boolean
  sort: number
  createdAt: string
}

export interface TodoDTO {
  id: number
  groupId?: number | null
  content: string
  remark?: string | null
  shelved: boolean
  owner?: string | null
  collaborators?: string[] | null
  planStart?: string | null
  planEnd?: string | null
  done: boolean
  status: TodoStatus
  doneAt?: string | null
  sort: number
  pinned: boolean
  remindEnabled: boolean
  remindRule?: RemindRule | null
  steps?: TodoStepDTO[]
  createdAt: string
}

/** 应用内提醒事件（调度器触发，前端轮询拉取） */
export interface RemindEventDTO {
  id: string
  /** 关联的消息中心消息 id（卡片操作时同步标记已读） */
  messageId: number | null
  todoId: number
  kind: 'start' | 'end' | 'deadline-start' | 'deadline-end'
  title: string
  body: string
  firedAt: string
}

export interface CreateGroupPayload { name: string }
export interface UpdateGroupPayload { name?: string; sort?: number; pinned?: boolean }
export interface CreateTodoPayload {
  content: string
  groupId?: number | null
  remark?: string
  shelved?: boolean
  owner?: string
  collaborators?: string[]
  planStart?: string
  planEnd?: string
  status?: TodoStatus
  pinned?: boolean
  remindEnabled?: boolean
  remindRule?: RemindRule | null
}
export interface UpdateTodoPayload extends Partial<CreateTodoPayload> {
  done?: boolean
}

export const todoApi = {
  listGroups: () => http.get<{ list: TodoGroupDTO[] }>('/todos/groups').then((r) => r.data.list),
  createGroup: (p: CreateGroupPayload) => http.post<{ group: TodoGroupDTO }>('/todos/groups', p).then((r) => r.data.group),
  updateGroup: (id: number, p: UpdateGroupPayload) => http.put<{ group: TodoGroupDTO }>(`/todos/groups/${id}`, p).then((r) => r.data.group),
  deleteGroup: (id: number) => http.delete(`/todos/groups/${id}`).then((r) => r.data),
  reorderGroups: (orders: { id: number; sort: number }[]) => http.post('/todos/groups/reorder', { orders }).then((r) => r.data),

  listTodos: (params: { groupId?: number; filter?: 'uncompleted' | 'today' | 'overdue' | 'ungrouped' } = {}) =>
    http.get<{ list: TodoDTO[] }>('/todos', { params }).then((r) => r.data.list),
  /** 单条详情（编辑器打开前重新拉取最新数据） */
  getTodo: (id: number) =>
    http.get<{ todo: TodoDTO }>(`/todos/${id}`).then((r) => r.data.todo),
  createTodo: (p: CreateTodoPayload) =>
    http.post<{ todo: TodoDTO; remindNotice?: string }>('/todos', p).then((r) => r.data),
  updateTodo: (id: number, p: UpdateTodoPayload) =>
    http.put<{ todo: TodoDTO; remindNotice?: string }>(`/todos/${id}`, p).then((r) => r.data),
  deleteTodo: (id: number) => http.delete(`/todos/${id}`).then((r) => r.data),
  reorderTodos: (orders: { id: number; sort: number }[]) => http.post('/todos/reorder', { orders }).then((r) => r.data),

  // ---- 步骤 ----
  createStep: (todoId: number, content: string) =>
    http.post<{ step: TodoStepDTO }>(`/todos/${todoId}/steps`, { content }).then((r) => r.data.step),
  updateStep: (todoId: number, stepId: number, p: { content?: string; done?: boolean }) =>
    http.put<{ step: TodoStepDTO }>(`/todos/${todoId}/steps/${stepId}`, p).then((r) => r.data.step),
  deleteStep: (todoId: number, stepId: number) =>
    http.delete(`/todos/${todoId}/steps/${stepId}`).then((r) => r.data),
  reorderSteps: (todoId: number, orders: { id: number; sort: number }[]) =>
    http.post(`/todos/${todoId}/steps/reorder`, { orders }).then((r) => r.data),

  // ---- 应用内提醒 ----
  /** 拉取（并清空）当前用户的提醒事件，供左下角提醒卡片展示 */
  listReminders: () =>
    http.get<{ list: RemindEventDTO[] }>('/reminders').then((r) => r.data.list),
  /** 关闭待办提醒设置（「不再提醒」按钮） */
  disableRemind: (todoId: number) =>
    http.put<{ todo: TodoDTO }>(`/todos/${todoId}`, { remindEnabled: false }).then((r) => r.data.todo)
}
