import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { AppDataSource } from '../../data-source'
import { User } from '../../entities/User'
import { UserConfig } from '../../entities/UserConfig'
import { isStrongPassword, validateEmail } from '../../utils/strong-password'
import { signToken, authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'

const router = Router()

/**
 * 注册：邮箱 + 强密码
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name } = req.body || {}
  if (!email || !password) throw new HttpError(400, 'INVALID_INPUT', '邮箱与密码必填')
  if (!validateEmail(email)) throw new HttpError(400, 'INVALID_INPUT', '邮箱格式不正确')
  if (!isStrongPassword(password)) {
    throw new HttpError(400, 'WEAK_PASSWORD', '密码必须 ≥8 位，且包含大小写字母、数字与特殊字符')
  }
  const repo = AppDataSource.getRepository(User)
  const exists = await repo.findOne({ where: { email: String(email).toLowerCase() } })
  if (exists) throw new HttpError(409, 'EMAIL_EXISTS', '该邮箱已注册')
  const passwordHash = await bcrypt.hash(password, 10)
  const u = repo.create({ email: String(email).toLowerCase(), passwordHash, name: name || null })
  await repo.save(u)

  // 初始化用户配置
  const cfgRepo = AppDataSource.getRepository(UserConfig)
  await cfgRepo.save(cfgRepo.create({ userId: u.id, themeDefault: 'light', themeFollowTime: true, langDefault: 'zh' }))

  const token = signToken({ id: u.id, email: u.email })
  res.status(201).json({ token, user: { id: u.id, email: u.email, name: u.name, avatarPath: u.avatarPath } })
}))

/**
 * 登录
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password, rememberDays } = req.body || {}
  if (!email || !password) throw new HttpError(400, 'INVALID_INPUT', '邮箱与密码必填')
  const repo = AppDataSource.getRepository(User)
  const u = await repo.findOne({ where: { email: String(email).toLowerCase() }, select: ['id', 'email', 'passwordHash', 'name', 'avatarPath'] })
  if (!u) throw new HttpError(404, 'NOT_FOUND', '账户不存在')
  const ok = await bcrypt.compare(password, u.passwordHash)
  if (!ok) throw new HttpError(401, 'BAD_CREDENTIALS', '邮箱或密码错误')
  // 免登录：7/15/30 天签发对应有效期的 token，默认走 env 配置
  const days = [7, 15, 30].includes(Number(rememberDays)) ? `${Number(rememberDays)}d` : undefined
  const token = signToken({ id: u.id, email: u.email }, days)
  res.json({ token, user: { id: u.id, email: u.email, name: u.name, avatarPath: u.avatarPath } })
}))

/**
 * 修改密码：验证旧密码 → 强密码校验 → 重新哈希落库
 */
router.post('/change-password', authRequired, asyncHandler(async (req: AuthedRequest, res) => {
  const { oldPassword, newPassword } = req.body || {}
  if (!oldPassword || !newPassword) throw new HttpError(400, 'INVALID_INPUT', '旧密码与新密码必填')
  if (!isStrongPassword(newPassword)) {
    throw new HttpError(400, 'WEAK_PASSWORD', '密码必须 ≥8 位，且包含大小写字母、数字与特殊字符')
  }
  if (oldPassword === newPassword) {
    throw new HttpError(400, 'SAME_PASSWORD', '新密码不能与旧密码相同')
  }
  const repo = AppDataSource.getRepository(User)
  const u = await repo.findOne({ where: { id: req.user!.id }, select: ['id', 'passwordHash'] })
  if (!u) throw new HttpError(404, 'NOT_FOUND', '用户不存在')
  const ok = await bcrypt.compare(oldPassword, u.passwordHash)
  // 注意：业务校验错误用 400 而非 401 —— 401 会被前端拦截器视为登录态失效并强制跳登录页
  if (!ok) throw new HttpError(400, 'BAD_OLD_PASSWORD', '旧密码错误')
  u.passwordHash = await bcrypt.hash(newPassword, 10)
  await repo.save(u)
  res.json({ ok: true })
}))

/**
 * 获取当前用户
 */
router.get('/me', authRequired, asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(User)
  const u = await repo.findOne({ where: { id: req.user!.id }, select: ['id', 'email', 'name', 'avatarPath', 'phone'] })
  if (!u) throw new HttpError(404, 'NOT_FOUND', '用户不存在')
  res.json({ user: u })
}))

/**
 * 注册用户列表（供待办负责人选择）
 */
router.get('/users', authRequired, asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(User)
  const list = await repo.find({ select: ['id', 'name', 'email'] })
  res.json({ list })
}))

export { router as authRouter }
