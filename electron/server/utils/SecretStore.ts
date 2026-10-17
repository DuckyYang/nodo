import crypto from 'node:crypto'
import os from 'node:os'

/**
 * 简单密钥存储：以机器 + 用户 id 派生 AES-256-GCM 密钥加密 api_key 等敏感字段。
 * 注意：这是桌面端本机加密，对同机同用户文件系统访问者不再提供额外保护；
 * 真正生产级保护需结合 OS keychain（keytar），此处先满足"非明文落库"要求。
 */
const PEPPER = 'nodo::secret::pepper::v1'

function machineKey(userId: number): Buffer {
  const hostname = os.hostname()
  const platform = process.platform
  const user = os.userInfo().username || 'unknown'
  const raw = `${PEPPER}::${platform}::${hostname}::${user}::${userId}`
  return crypto.createHash('sha256').update(raw).digest() // 32 bytes
}

export function encrypt(plain: string, userId: number): string {
  if (!plain) return ''
  const key = machineKey(userId)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decrypt(payload: string, userId: number): string {
  if (!payload) return ''
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return ''
  try {
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const enc = Buffer.from(parts[3], 'base64')
    const key = machineKey(userId)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return dec.toString('utf8')
  } catch {
    return ''
  }
}

export function maskKey(s?: string): string {
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}
