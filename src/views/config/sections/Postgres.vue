<template>
  <el-form :model="form" label-position="top" v-loading="loading">
    <el-form-item :label="t('config.pgHost')">
      <el-input v-model="form.host" placeholder="127.0.0.1" />
    </el-form-item>
    <el-form-item :label="t('config.pgPort')">
      <el-input-number v-model="form.port" :min="1" :max="65535" :controls="false" style="width: 160px" />
    </el-form-item>
    <el-form-item :label="t('config.pgUser')">
      <el-input v-model="form.user" placeholder="postgres" />
    </el-form-item>
    <el-form-item :label="t('config.pgPassword')">
      <el-input v-model="form.password" type="password" show-password />
      <p v-if="maskHint" class="tip">{{ maskHint }}</p>
    </el-form-item>
    <el-form-item :label="t('config.pgDatabase')">
      <el-input v-model="form.database" placeholder="nodo" />
      <p class="tip">{{ t('config.postgresTip') }}</p>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="saving" @click="onSave">{{ t('actions.save') }}</el-button>
      <el-button :loading="testing" @click="onTest">{{ t('config.pgTest') }}</el-button>
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
const form = ref<{ host?: string; port?: number; user?: string; password?: string; database?: string }>({
  host: '',
  port: 5432,
  user: '',
  password: '',
  database: ''
})
const maskHint = ref('')
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const emit = defineEmits<{ saved: [] }>()

onMounted(async () => {
  loading.value = true
  try {
    const cfg = await configApi.get()
    if (cfg.postgresConfig) {
      const p = cfg.postgresConfig
      form.value = {
        host: p.host || '',
        port: p.port || 5432,
        user: p.user || '',
        password: '',
        database: p.database || ''
      }
      maskHint.value = p.password ? `${t('config.currentKey')}${p.password}` : ''
    }
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    loading.value = false
  }
})

/** 测试连接：用当前表单（密码为空则用已存密码），不落库 */
async function onTest() {
  testing.value = true
  try {
    await configApi.testPostgres({ ...form.value })
    ElMessage.success(t('toast.pgTestOk'))
  } catch (e) {
    ElMessage.error(`${t('config.pgTestFail')}：${apiError(e)}`)
  } finally {
    testing.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    const payload: any = { ...form.value }
    // 密码留空 = 保留已存值（后端合并）
    if (!payload.password) delete payload.password
    const res = await configApi.updatePostgres(payload)
    if (res?.password) maskHint.value = `${t('config.currentKey')}${res.password}`
    form.value.password = ''
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
