import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark'

/** 时间规则：8-17 点白天，其余黑夜 */
export function calcModeByTime(now = new Date()): ThemeMode {
  const h = now.getHours()
  return h >= 8 && h < 17 ? 'light' : 'dark'
}

let timer: any = null

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>('light')
  const followTime = ref(false)
  const inited = ref(false)

  function apply() {
    document.documentElement.classList.toggle('dark', mode.value === 'dark')
    // 同步 Electron 原生标题栏颜色（Windows）
    try {
      window.nodo?.setNativeTheme?.(mode.value)
    } catch {}
  }

  async function setMode(m: ThemeMode) {
    mode.value = m
    try {
      await window.nodo?.setLocalTheme(m)
    } catch {}
  }

  async function setFollowTime(v: boolean) {
    followTime.value = v
    if (v) await setMode(calcModeByTime())
  }

  // mode 变化自动应用（含原生标题栏同步），不再依赖手动 apply
  watch(mode, apply)

  watch(followTime, (v) => {
    if (v) startTimer()
    else stopTimer()
  })

  function startTimer() {
    stopTimer()
    timer = setInterval(() => {
      if ((mode.value) && followTime.value) {
        const m = calcModeByTime()
        if (m !== mode.value) setMode(m)
      }
    }, 60_000)
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { mode, followTime, inited, setMode, setFollowTime, apply, startTimer, stopTimer }
})
