<template>
  <el-form :model="form" label-position="top" v-loading="loading">
    <el-form-item :label="t('config.apiKey')">
      <el-input v-model="form.apiKey" type="password" show-password placeholder="tvly-..." />
      <p class="tip">{{ t('config.tavilyTip') }}</p>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="saving" @click="onSave">{{ t('actions.save') }}</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { configApi } from '../../../api/config'
import { useConfigStore } from '../../../stores/config'
import { apiError } from '../../../api/http'

const { t } = useI18n()
const cfgStore = useConfigStore()
const form = ref<any>({ apiKey: '' })
const maskHint = ref('')
const loading = ref(false)
const saving = ref(false)
const emit = defineEmits<{ saved: [] }>()

onMounted(async () => {
  loading.value = true
  try {
    const cfg = await configApi.get()
    if (cfg.bochaConfig) {
      maskHint.value = cfg.bochaConfig.apiKey ? `${t('config.currentKey')}${cfg.bochaConfig.apiKey}` : ''
    }
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    loading.value = false
  }
})

async function onSave() {
  saving.value = true
  try {
    const payload: any = { ...form.value }
    if (!payload.apiKey) delete payload.apiKey
    const res = await configApi.updateBocha(payload)
    if (res?.apiKey) maskHint.value = `${t('config.currentKey')}${res.apiKey}`
    form.value.apiKey = ''
    await cfgStore.reload()
    emit('saved')
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin: 4px 0 0; }
</style>
