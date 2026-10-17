import { Router } from 'express'
import { In } from 'typeorm'
import { AppDataSource } from '../../data-source'
import { TodoGroup } from '../../entities/TodoGroup'
import { Todo, RemindRule, type TodoStatus } from '../../entities/Todo'
import { TodoStep } from '../../entities/TodoStep'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'

/** 合法状态值 */
const STATUSES: TodoStatus[] = ['not_started', 'in_progress', 'completed']

/**
 * 提醒规则校验与规范化：
 * - x（startBeforeMinutes / endBeforeMinutes）≥ 3 分钟
 * - y（repeatIntervalMinutes）≥ 1 且 ≤ x（取开启提醒的最小 x 约束）
 * - x == y 时窗口内只会触发一次提醒（返回提示文案，前端 toast 告知用户）
 * - 依赖校验：开启开始提醒必须有计划开始时间；开启结束提醒必须有计划完成时间
 * 返回 [规范化后的规则, 提示文案（可选）]
 */
function normalizeRemindRule(rule: any, times: { planStart?: Date | null; planEnd?: Date | null }): [RemindRule, string | undefined] {
  if (!rule || typeof rule !== 'object') return [{ repeatEnabled: false }, undefined]
  const r: RemindRule = {
    startBeforeMinutes: rule.startBeforeMinutes != null ? Math.floor(Number(rule.startBeforeMinutes)) : undefined,
    endBeforeMinutes: rule.endBeforeMinutes != null ? Math.floor(Number(rule.endBeforeMinutes)) : undefined,
    repeatEnabled: !!rule.repeatEnabled,
    repeatIntervalMinutes: rule.repeatIntervalMinutes != null ? Math.floor(Number(rule.repeatIntervalMinutes)) : undefined
  }
  // x ≥ 3（开启的提醒项才校验）
  if (r.startBeforeMinutes != null && r.startBeforeMinutes < 3)
    throw new HttpError(400, 'INVALID_INPUT', '开始提醒的提前分钟数至少为 3 分钟')
  if (r.endBeforeMinutes != null && r.endBeforeMinutes < 3)
    throw new HttpError(400, 'INVALID_INPUT', '结束提醒的提前分钟数至少为 3 分钟')
  // 提醒项依赖计划时间：没时间就没有提醒锚点
  if (r.startBeforeMinutes != null && !times.planStart)
    throw new HttpError(400, 'INVALID_INPUT', '设置开始提醒前，请先填写计划开始时间')
  if (r.endBeforeMinutes != null && !times.planEnd)
    throw new HttpError(400, 'INVALID_INPUT', '设置结束提醒前，请先填写计划完成时间')
  if (r.repeatEnabled) {
    const minX = Math.min(
      ...(r.startBeforeMinutes != null ? [r.startBeforeMinutes] : []),
      ...(r.endBeforeMinutes != null ? [r.endBeforeMinutes] : [])
    )
    // 没有任何提醒项时开启重复无意义
    if (!Number.isFinite(minX)) {
      r.repeatEnabled = false
      r.repeatIntervalMinutes = undefined
    } else {
      if (r.repeatIntervalMinutes == null || r.repeatIntervalMinutes < 1)
        throw new HttpError(400, 'INVALID_INPUT', '重复提醒间隔至少为 1 分钟')
      if (r.repeatIntervalMinutes > minX)
        throw new HttpError(400, 'INVALID_INPUT', `重复提醒间隔不能超过提前分钟数（${minX} 分钟）`)
    }
  } else {
    r.repeatIntervalMinutes = undefined
  }
  // x == y：窗口 [目标-x, 目标] 内首次触发后，距上次提醒 ≥ y 分钟的条件
  // 在剩余窗口内已不满足 → 只会提醒一次
  let notice: string | undefined
  if (r.repeatEnabled && r.repeatIntervalMinutes != null) {
    const eq = (r.startBeforeMinutes != null && r.startBeforeMinutes === r.repeatIntervalMinutes)
      || (r.endBeforeMinutes != null && r.endBeforeMinutes === r.repeatIntervalMinutes)
    if (eq) notice = '提醒间隔与提前分钟数相同，提醒窗口内将只提醒一次'
  }
  return [r, notice]
}

/** status 与 done 双向同步（done 是历史字段，过滤/拖拽/AI 工具依赖它） */
function syncStatusDone(t: Todo, patch: { status?: any; done?: any }) {
  if (patch.status !== undefined) {
    const s = String(patch.status)
    if (!STATUSES.includes(s as TodoStatus)) throw new HttpError(400, 'INVALID_INPUT', `非法状态：${s}`)
    t.status = s as TodoStatus
    // 状态驱动完成标记（completed ↔ done=true）
    if (t.status === 'completed') {
      t.done = true
      t.doneAt = t.doneAt || new Date()
    } else {
      t.done = false
      t.doneAt = null
    }
  }
  if (patch.done !== undefined) {
    t.done = Boolean(patch.done)
    t.doneAt = t.done ? (t.doneAt || new Date()) : null
    // 完成标记驱动状态（done=true → completed；done=false → 未开始，除非当前已是进行中）
    if (t.done) t.status = 'completed'
    else if (t.status === 'completed') t.status = 'not_started'
  }
}

const router = Router()
router.use(authRequired)

// ============== 分组 ==============

router.get('/groups', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(TodoGroup)
  const list = await repo.find({ where: { userId: req.user!.id }, order: { pinned: 'DESC', sort: 'ASC', createdAt: 'ASC' } })
  res.json({ list })
}))

router.post('/groups', asyncHandler(async (req: AuthedRequest, res) => {
  const { name } = req.body || {}
  if (!name || !String(name).trim()) throw new HttpError(400, 'INVALID_INPUT', '分组名称必填')
  const repo = AppDataSource.getRepository(TodoGroup)
  const count = await repo.count({ where: { userId: req.user!.id } })
  const g = repo.create({ userId: req.user!.id, name: String(name).trim(), sort: count, pinned: false })
  await repo.save(g)
  res.status(201).json({ group: g })
}))

router.put('/groups/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10)
  const repo = AppDataSource.getRepository(TodoGroup)
  const g = await repo.findOne({ where: { id, userId: req.user!.id } })
  if (!g) throw new HttpError(404, 'NOT_FOUND', '分组不存在')
  const { name, sort, pinned } = req.body || {}
  if (name !== undefined) g.name = String(name)
  if (sort !== undefined) g.sort = Number(sort)
  if (pinned !== undefined) g.pinned = Boolean(pinned)
  await repo.save(g)
  res.json({ group: g })
}))

router.delete('/groups/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10)
  const repo = AppDataSource.getRepository(TodoGroup)
  const g = await repo.findOne({ where: { id, userId: req.user!.id } })
  if (!g) throw new HttpError(404, 'NOT_FOUND', '分组不存在')
  // 把分组下的待办的 groupId 置空
  await AppDataSource.getRepository(Todo).update({ groupId: id }, { groupId: null })
  await repo.delete(id)
  res.json({ ok: true })
}))

// 批量重排
router.post('/groups/reorder', asyncHandler(async (req: AuthedRequest, res) => {
  const { orders } = req.body || {}
  if (!Array.isArray(orders)) throw new HttpError(400, 'INVALID_INPUT', 'orders 必须是数组')
  const repo = AppDataSource.getRepository(TodoGroup)
  for (const o of orders) {
    if (o.id && o.sort !== undefined) {
      await repo.update({ id: o.id, userId: req.user!.id }, { sort: Number(o.sort) })
    }
  }
  res.json({ ok: true })
}))

// ============== 待办 ==============

async function loadTodos(req: AuthedRequest, where: any = {}) {
  const repo = AppDataSource.getRepository(Todo)
  const list = await repo.find({
    where: { userId: req.user!.id, ...where },
    order: { pinned: 'DESC', sort: 'ASC', createdAt: 'DESC' }
  })
  // 存量数据回填：加列前已完成（done=1）的旧数据 status 还是 not_started，读取时修正
  for (const t of list) {
    if (t.done && t.status !== 'completed') {
      t.status = 'completed'
      // 异步持久化，不阻塞响应
      repo.update(t.id, { status: 'completed' }).catch(() => {})
    } else if (!t.done && t.status === 'completed') {
      t.status = 'not_started'
      repo.update(t.id, { status: 'not_started' }).catch(() => {})
    }
  }
  // 附带步骤列表（列表计数显示 + 编辑器回填）
  if (list.length) {
    const stepRepo = AppDataSource.getRepository(TodoStep)
    const steps = await stepRepo.find({
      where: { todoId: In(list.map((t) => t.id)) },
      order: { sort: 'ASC', id: 'ASC' }
    })
    const byTodo = new Map<number, TodoStep[]>()
    for (const s of steps) {
      if (!byTodo.has(s.todoId)) byTodo.set(s.todoId, [])
      byTodo.get(s.todoId)!.push(s)
    }
    for (const t of list) t.steps = byTodo.get(t.id) || []
  }
  return list
}

router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const groupId = req.query.groupId as string | undefined
  const filter = req.query.filter as string | undefined // uncompleted | today | overdue | ungrouped
  const where: any = {}
  if (groupId) where.groupId = parseInt(groupId, 10)

  let list = await loadTodos(req, where)

  if (filter === 'uncompleted') {
    list = list.filter((t) => !t.done)
  } else if (filter === 'today') {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start.getTime() + 86400000)
    list = list.filter((t) => t.planStart && t.planStart >= start && t.planStart < end)
  } else if (filter === 'overdue') {
    const now = new Date()
    list = list.filter((t) => !t.done && t.planEnd && t.planEnd < now)
  } else if (filter === 'ungrouped') {
    list = list.filter((t) => !t.groupId)
  }
  res.json({ list })
}))

// 单条详情：编辑器打开前重新拉取最新数据（列表缓存可能过期）
router.get('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10)
  const list = await loadTodos(req, { id })
  if (!list.length) throw new HttpError(404, 'NOT_FOUND', '待办不存在')
  res.json({ todo: list[0] })
}))

router.post('/', asyncHandler(async (req: AuthedRequest, res) => {
  const b = req.body || {}
  if (!b.content) throw new HttpError(400, 'INVALID_INPUT', '待办内容必填')
  const repo = AppDataSource.getRepository(Todo)
  const count = await repo.count({ where: { userId: req.user!.id } })
  const planStart = b.planStart ? new Date(b.planStart) : null
  const planEnd = b.planEnd ? new Date(b.planEnd) : null
  const remindRule: RemindRule | null = b.remindEnabled ? normalizeRemindRule(b.remindRule, { planStart, planEnd })[0] : null
  // status 与 done 联动：新建即选「已完成」时正确落 done/doneAt
  const status: TodoStatus = b.status && STATUSES.includes(b.status) ? b.status : 'not_started'
  const t = repo.create({
    userId: req.user!.id,
    groupId: b.groupId ?? null,
    content: String(b.content),
    remark: b.remark || null,
    shelved: !!b.shelved,
    owner: b.owner || null,
    collaborators: b.collaborators || null,
    planStart,
    planEnd,
    done: status === 'completed',
    doneAt: status === 'completed' ? new Date() : null,
    status,
    sort: typeof b.sort === 'number' ? b.sort : count,
    pinned: !!b.pinned,
    remindEnabled: !!b.remindEnabled,
    remindRule
  })
  await repo.save(t)
  res.status(201).json({ todo: t, remindNotice: b.remindEnabled ? normalizeRemindRule(b.remindRule, { planStart, planEnd })[1] : undefined })
}))

router.put('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10)
  const repo = AppDataSource.getRepository(Todo)
  const t = await repo.findOne({ where: { id, userId: req.user!.id } })
  if (!t) throw new HttpError(404, 'NOT_FOUND', '待办不存在')
  const b = req.body || {}
  const fields = ['content', 'remark', 'shelved', 'owner', 'collaborators', 'groupId', 'sort', 'pinned', 'remindEnabled']
  for (const f of fields) {
    if (b[f] !== undefined) (t as any)[f] = b[f]
  }
  if (b.planStart !== undefined) t.planStart = b.planStart ? new Date(b.planStart) : null
  if (b.planEnd !== undefined) t.planEnd = b.planEnd ? new Date(b.planEnd) : null
  // status 与 done 双向同步（两字段都传时 status 优先，见 syncStatusDone 内部顺序）
  syncStatusDone(t, b)
  let remindNotice: string | undefined
  if (b.remindRule !== undefined) {
    t.remindRule = b.remindEnabled === false ? null : normalizeRemindRule(b.remindRule, { planStart: t.planStart, planEnd: t.planEnd })[0]
  } else if (b.remindEnabled === true && !t.remindRule) {
    t.remindRule = { repeatEnabled: false }
  }
  if (b.remindEnabled === true || (b.remindRule !== undefined && b.remindEnabled !== false)) {
    remindNotice = normalizeRemindRule(b.remindRule || t.remindRule, { planStart: t.planStart, planEnd: t.planEnd })[1]
  }
  await repo.save(t)
  res.json({ todo: t, remindNotice })
}))

router.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10)
  const repo = AppDataSource.getRepository(Todo)
  const t = await repo.findOne({ where: { id, userId: req.user!.id } })
  if (!t) throw new HttpError(404, 'NOT_FOUND', '待办不存在')
  // 级联删除步骤
  await AppDataSource.getRepository(TodoStep).delete({ todoId: id })
  await repo.delete(id)
  res.json({ ok: true })
}))

// 批量重排
router.post('/reorder', asyncHandler(async (req: AuthedRequest, res) => {
  const { orders } = req.body || {}
  if (!Array.isArray(orders)) throw new HttpError(400, 'INVALID_INPUT', 'orders 必须是数组')
  const repo = AppDataSource.getRepository(Todo)
  for (const o of orders) {
    if (o.id && o.sort !== undefined) {
      await repo.update({ id: o.id, userId: req.user!.id }, { sort: Number(o.sort) })
    }
  }
  res.json({ ok: true })
}))

// ============== 步骤 ==============

/** 确认待办归属当前用户，返回步骤仓库 */
async function stepContext(req: AuthedRequest, todoId: number) {
  const todo = await AppDataSource.getRepository(Todo).findOne({ where: { id: todoId, userId: req.user!.id } })
  if (!todo) throw new HttpError(404, 'NOT_FOUND', '待办不存在')
  return AppDataSource.getRepository(TodoStep)
}

// 新建步骤
router.post('/:todoId/steps', asyncHandler(async (req: AuthedRequest, res) => {
  const todoId = parseInt(req.params.todoId, 10)
  const stepRepo = await stepContext(req, todoId)
  const { content } = req.body || {}
  if (!content || !String(content).trim()) throw new HttpError(400, 'INVALID_INPUT', '步骤内容必填')
  const count = await stepRepo.count({ where: { todoId } })
  const s = stepRepo.create({ todoId, content: String(content).trim(), done: false, sort: count })
  await stepRepo.save(s)
  res.status(201).json({ step: s })
}))

// 修改步骤（内容/完成标记）
router.put('/:todoId/steps/:stepId', asyncHandler(async (req: AuthedRequest, res) => {
  const todoId = parseInt(req.params.todoId, 10)
  const stepId = parseInt(req.params.stepId, 10)
  const stepRepo = await stepContext(req, todoId)
  const s = await stepRepo.findOne({ where: { id: stepId, todoId } })
  if (!s) throw new HttpError(404, 'NOT_FOUND', '步骤不存在')
  const { content, done } = req.body || {}
  if (content !== undefined) {
    if (!String(content).trim()) throw new HttpError(400, 'INVALID_INPUT', '步骤内容必填')
    s.content = String(content).trim()
  }
  if (done !== undefined) s.done = Boolean(done)
  await stepRepo.save(s)
  res.json({ step: s })
}))

// 删除步骤
router.delete('/:todoId/steps/:stepId', asyncHandler(async (req: AuthedRequest, res) => {
  const todoId = parseInt(req.params.todoId, 10)
  const stepId = parseInt(req.params.stepId, 10)
  const stepRepo = await stepContext(req, todoId)
  const s = await stepRepo.findOne({ where: { id: stepId, todoId } })
  if (!s) throw new HttpError(404, 'NOT_FOUND', '步骤不存在')
  await stepRepo.delete(stepId)
  res.json({ ok: true })
}))

// 步骤批量重排（拖拽）
router.post('/:todoId/steps/reorder', asyncHandler(async (req: AuthedRequest, res) => {
  const todoId = parseInt(req.params.todoId, 10)
  const stepRepo = await stepContext(req, todoId)
  const { orders } = req.body || {}
  if (!Array.isArray(orders)) throw new HttpError(400, 'INVALID_INPUT', 'orders 必须是数组')
  for (const o of orders) {
    if (o.id && o.sort !== undefined) {
      await stepRepo.update({ id: o.id, todoId }, { sort: Number(o.sort) })
    }
  }
  res.json({ ok: true })
}))

export { router as todoRouter }
