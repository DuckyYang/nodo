import type { Response, Request, NextFunction } from 'express'

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.code, message: err.message })
  }
  const e = err as Error & { code?: string }
  console.error('[error]', err)
  const status = (e as any).status || 500
  return res.status(status).json({ code: e.code || 'INTERNAL', message: e.message || '服务器内部错误' })
}

export function asyncHandler<T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next)
  }
}
