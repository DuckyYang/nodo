import { AppDataSource } from '../data-source'
import { Todo, RemindRule, type TodoStatus } from '../entities/Todo'
import { TodoGroup } from '../entities/TodoGroup'
import { IsNull, type DeepPartial } from 'typeorm'

/** 合法状态值 */
const STATUSES: TodoStatus[] = ['not_started', 'in_progress', 'completed']

/**
 * AI 入口的提醒规则规范化：分钟数裁剪到合法区间；
 * 没有对应计划时间时剥离提醒项（没时间就没有提醒锚点，规则形同虚设）。
 */
function normalizeRule(rule: RemindRule | null | undefined, planStart: Date | null, planEnd: Date | null): RemindRule | null {
  if (!rule) return null
  const startBeforeMinutes = rule.startBeforeMinutes != null && planStart ? Math.max(3, Math.floor(rule.startBeforeMinutes)) : undefined
  const endBeforeMinutes = rule.endBeforeMinutes != null && planEnd ? Math.max(3, Math.floor(rule.endBeforeMinutes)) : undefined
  return {
    startBeforeMinutes,
    endBeforeMinutes,
    repeatEnabled: !!(rule.repeatEnabled && (startBeforeMinutes != null || endBeforeMinutes != null)),
    repeatIntervalMinutes: rule.repeatEnabled ? Math.max(1, Math.floor(rule.repeatIntervalMinutes ?? 1)) : undefined
  }
}

/**
 * AI 小助理可调用的待办工具集合（待办与分组的增/查/改 + 受控删除）。
 */
export class TodoTools {
  constructor(private userId: number) {}

  async add(input: {
    content: string
    groupId?: number | null
    remark?: string
    owner?: string
    planStart?: string
    planEnd?: string
    status?: TodoStatus
    remindRule?: RemindRule | null
    pinned?: boolean
    remindEnabled?: boolean
  }) {
    const repo = AppDataSource.getRepository(Todo)
    const count = await repo.count({ where: { userId: this.userId } })
    // status 驱动 done（AI 工具入口的双字段同步）
    const status: TodoStatus = input.status && STATUSES.includes(input.status) ? input.status : 'not_started'
    const planStart = input.planStart ? new Date(input.planStart) : null
    const planEnd = input.planEnd ? new Date(input.planEnd) : null
    const t = repo.create({
      userId: this.userId,
      groupId: input.groupId ?? null,
      content: String(input.content),
      remark: input.remark || null,
      owner: input.owner || null,
      planStart,
      planEnd,
      done: status === 'completed',
      status,
      sort: Number(count),
      pinned: !!input.pinned,
      remindEnabled: !!input.remindEnabled,
      // AI 入口的提醒规则（无时间锚点的提醒项会被剥离）
      remindRule: input.remindEnabled ? normalizeRule(input.remindRule, planStart, planEnd) : null
    } as DeepPartial<Todo>)
    await repo.save(t)
    return t
  }

  /**
   * 查询待办：按分组/完成状态/时间维度过滤 + 关键词匹配。
   * filter: uncompleted=未完成 | today=今天计划开始 | overdue=已逾期 |
   *         ungrouped=未分组（与前端 todo 模块语义一致）
   */
  async query(input: { groupId?: number | null; done?: boolean; filter?: string; keyword?: string }) {
    const repo = AppDataSource.getRepository(Todo)
    const where: any = { userId: this.userId }
    // groupId: null 显式查未分组（IS NULL）；undefined 不作为过滤条件
    if (input.groupId === null) where.groupId = IsNull()
    else if (input.groupId !== undefined) where.groupId = input.groupId
    if (input.done !== undefined) where.done = input.done
    let list = await repo.find({ where, order: { pinned: 'DESC', sort: 'ASC', createdAt: 'DESC' } })

    if (input.filter === 'uncompleted') list = list.filter((t) => !t.done)
    else if (input.filter === 'today') {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const end = new Date(start.getTime() + 86400000)
      list = list.filter((t) => t.planStart && t.planStart >= start && t.planStart < end)
    } else if (input.filter === 'overdue') {
      const now = new Date()
      list = list.filter((t) => !t.done && t.planEnd && t.planEnd < now)
    } else if (input.filter === 'ungrouped') {
      list = list.filter((t) => !t.groupId)
    }

    if (input.keyword) {
      const kw = input.keyword.toLowerCase()
      list = list.filter((t) => t.content.toLowerCase().includes(kw) || (t.remark || '').toLowerCase().includes(kw))
    }
    return list
  }

  async update(id: number, patch: Partial<Todo> & { status?: TodoStatus }) {
    const repo = AppDataSource.getRepository(Todo)
    const t = await repo.findOne({ where: { id, userId: this.userId } })
    if (!t) throw new Error('待办不存在')
    // 完成状态切换时同步完成时间（与前端 todo 模块行为一致）
    if (patch.done !== undefined) patch.doneAt = patch.done ? new Date() : null
    // status 驱动 done/doneAt（AI 工具以 status 表达状态时）
    if (patch.status !== undefined) {
      const s = STATUSES.includes(patch.status) ? patch.status : 'not_started'
      patch.status = s
      patch.done = s === 'completed'
      patch.doneAt = s === 'completed' ? new Date() : null
    } else if (patch.done !== undefined && patch.done) {
      // 无 status 时 done=true 联动状态
      patch.status = 'completed'
    }
    // AI 入口的提醒规则整体覆盖（null = 关闭提醒）；
    // 规则基于合并后的计划时间判定（同一请求可能同时改时间与规则）
    const hasRemindPatch = patch.remindRule !== undefined || patch.remindEnabled !== undefined
    Object.assign(t, patch)
    if (hasRemindPatch && t.remindEnabled) {
      t.remindRule = normalizeRule(t.remindRule, t.planStart ?? null, t.planEnd ?? null)
    }
    await repo.save(t)
    return t
  }

  async del(id: number) {
    const repo = AppDataSource.getRepository(Todo)
    const t = await repo.findOne({ where: { id, userId: this.userId } })
    if (!t) throw new Error('待办不存在')
    await repo.delete(id)
    return true
  }

  // ============== 分组 ==============

  async listGroups() {
    return AppDataSource.getRepository(TodoGroup).find({
      where: { userId: this.userId },
      order: { pinned: 'DESC', sort: 'ASC', createdAt: 'ASC' }
    })
  }

  async createGroup(input: { name: string }) {
    const repo = AppDataSource.getRepository(TodoGroup)
    const count = await repo.count({ where: { userId: this.userId } })
    const g = repo.create({ userId: this.userId, name: String(input.name).trim(), sort: count, pinned: false })
    await repo.save(g)
    return g
  }

  async updateGroup(id: number, patch: Partial<TodoGroup>) {
    const repo = AppDataSource.getRepository(TodoGroup)
    const g = await repo.findOne({ where: { id, userId: this.userId } })
    if (!g) throw new Error('分组不存在')
    Object.assign(g, patch)
    await repo.save(g)
    return g
  }

  /** 删除分组（组内待办的 groupId 置空，不删待办） */
  async deleteGroup(id: number) {
    const repo = AppDataSource.getRepository(TodoGroup)
    const g = await repo.findOne({ where: { id, userId: this.userId } })
    if (!g) throw new Error('分组不存在')
    await AppDataSource.getRepository(Todo).update({ groupId: id }, { groupId: null })
    await repo.delete(id)
    return true
  }
}
