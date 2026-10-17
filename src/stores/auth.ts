import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '../api/auth'

export interface UserInfo {
  id: number
  email: string
  name?: string | null
  avatarPath?: string | null
  phone?: string | null
}

const TOKEN_KEY = 'nodo:token'
const USER_KEY = 'nodo:user'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const user = ref<UserInfo | null>(JSON.parse(localStorage.getItem(USER_KEY) || 'null'))

  const isAuthed = computed(() => !!token.value)

  function setAuth(t: string, u: UserInfo) {
    token.value = t
    user.value = u
    localStorage.setItem(TOKEN_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  }

  async function login(email: string, password: string, rememberDays?: number) {
    const res = await authApi.login(email, password, rememberDays)
    setAuth(res.token, res.user)
    return res
  }

  async function register(email: string, password: string, name?: string) {
    const res = await authApi.register(email, password, name)
    setAuth(res.token, res.user)
    return res
  }

  async function refreshMe() {
    if (!token.value) return
    try {
      const res = await authApi.me()
      user.value = res.user
      localStorage.setItem(USER_KEY, JSON.stringify(res.user))
    } catch {
      logout()
    }
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  return { token, user, isAuthed, login, register, refreshMe, logout, setAuth }
})
