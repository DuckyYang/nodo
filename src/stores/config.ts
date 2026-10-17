import { defineStore } from 'pinia'
import { ref } from 'vue'
import { configApi, type FullConfigDTO } from '../api/config'

export const useConfigStore = defineStore('config', () => {
  const config = ref<FullConfigDTO | null>(null)
  const uiSize = ref<'small' | 'default' | 'large'>('default')
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      config.value = await configApi.get()
    } catch (e) {
      console.warn('config load failed', e)
    } finally {
      loading.value = false
    }
  }

  async function reload() {
    return load()
  }

  return { config, uiSize, loading, load, reload }
})
