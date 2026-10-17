import { useThemeStore } from '../stores/theme'
import { useConfigStore } from '../stores/config'
import { useAuthStore } from '../stores/auth'
import { useI18nStore } from '../stores/i18n'

export async function initTheme() {
  const theme = useThemeStore()
  const i18nStore = useI18nStore()

  i18nStore.init()

  // 优先从本地持久化读取
  try {
    const local = await window.nodo?.getLocalTheme()
    if (local === 'light' || local === 'dark') theme.setMode(local)
  } catch {}

  const auth = useAuthStore()
  if (auth.token) {
    const cfg = useConfigStore()
    try {
      await cfg.load()
      const c = cfg.config
      if (c) {
        if (c.themeFollowTime) {
          theme.setFollowTime(true)
        } else {
          // 历史数据兼容：曾存在 'auto'（跟随系统）选项，统一归一化为浅色
          theme.setMode((c.themeDefault === 'dark' ? 'dark' : 'light'))
        }
        if (c.langDefault === 'zh' || c.langDefault === 'en') {
          i18nStore.setLang(c.langDefault)
        }
      }
    } catch {}
  }

  theme.apply()
  theme.inited = true
}
