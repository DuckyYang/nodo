import { Router } from 'express'
import { AppDataSource } from '../../data-source'
import { Message, type MessageCategory } from '../../entities/Message'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'

/**
 * 消息中心路由：
 * - GET /           列表（read 未读/已读筛选 + category 分类筛选 + keyword 检索 + 分页）
 * - GET /unread     未读数（红点）
 * - PUT /:id/read   标记已读
 * - PUT /read-all   全部已读（可带 category 只清某一类）
 * - DELETE /read    清除已读消息（可带 category）
 */

const CATEGORIES: MessageCategory[] = ['todo', 'assistant']

const router = Router()
router.use(authRequired)

function parseCategory(v: unknown): MessageCategory | undefined {
  if (v == null || v === '') return undefined
  const s = String(v)
  return CATEGORIES.includes(s as MessageCategory) ? (s as MessageCategory) : undefined
}

// 消息列表：筛选 + 检索 + 分页（按时间倒序）
router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(Message)
  const q = repo
    .createQueryBuilder('m')
    .where('m.userId = :uid', { uid: req.user!.id })
    .orderBy('m.createdAt', 'DESC')

  // 已读状态筛选：unread=未读 read=已读（不传=全部）
  const read = String(req.query.read || '')
  if (read === 'unread') q.andWhere('m.read = 0')
  else if (read === 'read') q.andWhere('m.read = 1')

  // 分类筛选
  const category = parseCategory(req.query.category)
  if (category) q.andWhere('m.category = :cat', { cat: category })

  // 关键词检索（标题 + 内容模糊匹配）
  const keyword = String(req.query.keyword || '').trim()
  if (keyword) {
    q.andWhere('(m.title LIKE :kw OR m.content LIKE :kw)', { kw: `%${keyword}%` })
  }

  const take = Math.min(parseInt(String(req.query.take || '50'), 10) || 50, 200)
  const skip = Math.max(parseInt(String(req.query.skip || '0'), 10) || 0, 0)
  q.take(take).skip(skip)

  const [list, total] = await q.getManyAndCount()
  res.json({ list, total })
}))

// 未读数（红点）
router.get('/unread', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(Message)
  const count = await repo.count({ where: { userId: req.user!.id, read: false } })
  res.json({ count })
}))

// 标记已读
router.put('/:id/read', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(Message)
  const m = await repo.findOne({ where: { id: parseInt(req.params.id, 10), userId: req.user!.id } })
  if (!m) throw new HttpError(404, 'NOT_FOUND', '消息不存在')
  m.read = true
  await repo.save(m)
  res.json({ message: m })
}))

// 全部已读（可带 category 只清某一类）
router.put('/read-all', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(Message)
  const where: any = { userId: req.user!.id, read: false }
  const category = parseCategory((req.body || {}).category ?? req.query.category)
  if (category) where.category = category
  await repo.update(where, { read: true })
  res.json({ ok: true })
}))

// 清除已读消息（可带 category）
router.delete('/read', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(Message)
  const where: any = { userId: req.user!.id, read: true }
  const category = parseCategory((req.body || {}).category ?? req.query.category)
  if (category) where.category = category
  await repo.delete(where)
  res.json({ ok: true })
}))

export { router as messagesRouter }
