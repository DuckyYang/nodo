/**
 * 强密码校验：≥8 位、含大小写字母、数字与特殊字符
 */
export function isStrongPassword(pwd: string): boolean {
  if (typeof pwd !== 'string' || pwd.length < 8) return false
  if (!/[a-z]/.test(pwd)) return false
  if (!/[A-Z]/.test(pwd)) return false
  if (!/[0-9]/.test(pwd)) return false
  if (!/[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>/?`~]/.test(pwd)) return false
  return true
}

export function validateEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)
}
