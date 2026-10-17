import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import i18n from '../i18n'

export type Lang = 'zh' | 'en'

export const useI18nStore = defineStore('i18n', () => {
  const lang = ref<Lang>('zh')

  // 注意：useI18n() 只能在组件 setup 中调用；
  // store 里直接操作 i18n 实例的 global（legacy: false 模式下为响应式）
  function setLang(l: Lang) {
    lang.value = l
    i18n.global.locale.value = l
  }

  watch(lang, (l) => {
    localStorage.setItem('nodo:lang', l)
  })

  function init() {
    const saved = localStorage.getItem('nodo:lang') as Lang | null
    if (saved === 'zh' || saved === 'en') {
      lang.value = saved
      i18n.global.locale.value = saved
    }
  }

  return { lang, setLang, init }
})
