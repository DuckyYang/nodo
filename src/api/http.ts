import axios, { AxiosError, type AxiosInstance } from 'axios'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import i18n from '../i18n'

const baseURL = `http://127.0.0.1:${import.meta.env.VITE_SERVER_PORT || 7070}`

export const http: AxiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('nodo:token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 401 处理进行中标志：并发 401 只提示/跳转一次 */
let handling401 = false

/**
 * 登录态失效统一处理：
 * - 同步清 pinia store 与 localStorage（router guard 读取的是 store，
 *   只清 localStorage 会导致 hash 跳 /login 时被 guard 的
 *   「已登录访问 guest 页 → 踢回功能页」规则弹回，永远到不了登录页）
 * - 1.5s 内的并发 401 只弹一次提示、只跳转一次
 */
function handle401(msg: string) {
  try {
    useAuthStore().logout()
  } catch { /* pinia 未就绪（极早期请求），localStorage 兜底 */ }
  localStorage.removeItem('nodo:token')
  localStorage.removeItem('nodo:user')
  if (handling401) return
  handling401 = true
  ElMessage.warning(msg || i18n.global.t('toast.loginRequired'))
  if (!location.hash.startsWith('#/login')) location.hash = '#/login'
  setTimeout(() => { handling401 = false }, 1500)
}

http.interceptors.response.use(
  (resp) => resp,
  (err: AxiosError<{ code?: string; message?: string }>) => {
    const status = err.response?.status
    const msg = err.response?.data?.message || err.message
    const url = err.config?.url || ''
    // 登录态失效：统一处理（登录/注册接口自身的 401 是凭据错误，走正常 reject 交给页面提示）
    if (status === 401 && !url.startsWith('/auth/')) {
      handle401(msg)
      // 返回永不 resolve 的 promise 吞掉错误传播：页面即将跳登录页，
      // 避免并发 401 让各组件的 catch 各弹一条重复错误
      return new Promise(() => {})
    }
    return Promise.reject(new Error(msg || i18n.global.t('assistant.requestFailed')))
  }
)

export const apiError = (e: unknown, fallback = '哎呀，出了点小问题'): string =>
  e instanceof Error ? e.message : fallback
