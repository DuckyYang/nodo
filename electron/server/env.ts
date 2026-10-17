import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'

/** 日志写到用户临时目录，用于诊断主进程启动问题（打包后 console 不可见） */
function dbg(msg: string) {
  try {
    const os = require('node:os') as typeof import('node:os')
    const logPath = path.join(os.tmpdir(), 'nodo-main.log')
    fs.appendFileSync(logPath, `${new Date().toISOString()} [main] ${msg}\n`)
  } catch {}
}

// 全局错误捕获：任何未处理异常记录到日志，避免进程静默崩溃
process.on('uncaughtException', (err: any) => {
  dbg('UNCAUGHT EXCEPTION: ' + (err?.stack || err?.message || String(err)))
})
process.on('unhandledRejection', (err: any) => {
  dbg('UNHANDLED REJECTION: ' + (err?.stack || err?.message || String(err)))
})

/** 尝试多个可能的位置加载 .env（开发期 process.cwd() 与打包后不同） */
function loadEnv() {
  const candidates = [
    process.env.NODE_ENV === 'production' && process.resourcesPath
      ? path.join(process.resourcesPath, '.env')
      : null,
    path.resolve(process.cwd(), '.env'),
    typeof __dirname !== 'undefined'
      ? path.resolve(__dirname, '../../.env') // out/main/ → 项目根
      : null,
    typeof __dirname !== 'undefined'
      ? path.resolve(__dirname, '../../../.env')
      : null
  ].filter(Boolean) as string[]

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p })
      return p
    }
  }
  return null
}

loadEnv()

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) throw new Error(`[env] missing ${name}`)
  return v
}

export const env = {
  db: {
    host: required('DB_HOST', '139.224.61.86'),
    port: parseInt(required('DB_PORT', '6033'), 10),
    user: required('DB_USER', 'nodo'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME', 'nodo')
  },
  server: {
    host: required('SERVER_HOST', '127.0.0.1'),
    port: parseInt(required('SERVER_PORT', '7070'), 10)
  },
  jwt: {
    secret: required('JWT_SECRET', 'nodo-dev-jwt-secret-please-rotate'),
    expires: required('JWT_EXPIRES', '7d')
  },
  isProd: process.env.NODE_ENV === 'production'
}
