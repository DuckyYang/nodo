import { http } from './http'
import type { UserInfo } from '../stores/auth'

export interface LoginResp { token: string; user: UserInfo }

export const authApi = {
  login: (email: string, password: string, rememberDays?: number) =>
    http.post<LoginResp>('/auth/login', { email, password, rememberDays }).then((r) => r.data),
  register: (email: string, password: string, name?: string) =>
    http.post<LoginResp>('/auth/register', { email, password, name }).then((r) => r.data),
  me: () => http.get<{ user: UserInfo }>('/auth/me').then((r) => r.data),
  listUsers: () =>
    http.get<{ list: { id: number; name: string; email: string }[] }>('/auth/users').then((r) => r.data.list)
}
