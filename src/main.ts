import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/main.scss'

import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { initTheme } from './theme'

async function bootstrap() {
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.use(i18n)
  // 全局提示：3 秒自动关闭 + hover 暂停计时是 ElMessage 默认行为；
  // 右上角定位与圆角气泡样式在 main.scss 全局覆盖
  app.use(ElementPlus)

  await initTheme()

  app.mount('#app')
}

bootstrap()
