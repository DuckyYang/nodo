import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../env'

export interface AuthedRequest extends Request {
  user?: { id: number; email: string }
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  // Bearer 头优先；EventSource 无法自定义头时经 query token 兜底（如 /assistant/wx-events）
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : String(req.query.token || '')
  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录' })
  }
  try {
    const decoded = jwt.verify(token, env.jwt.secret) as { id: number; email: string }
    req.user = { id: decoded.id, email: decoded.email }
    next()
  } catch {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' })
  }
}

export function signToken(payload: { id: number; email: string }, expiresIn?: string): string {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: (expiresIn || env.jwt.expires) as any })
}
