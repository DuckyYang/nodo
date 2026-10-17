<template>
  <el-form :model="form" label-position="top" v-loading="loading">
    <el-form-item :label="t('auth.name')">
      <el-input v-model="form.name" />
    </el-form-item>
    <el-form-item :label="t('auth.email')">
      <el-input v-model="form.email" disabled />
    </el-form-item>
    <el-form-item :label="t('auth.phone')">
      <el-input v-model="form.phone" />
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
import { http, apiError } from '../../../api/http'
import { useAuthStore } from '../../../stores/auth'

const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const auth = useAuthStore()
const form = ref({ name: '', email: '', phone: '' })
const loading = ref(false)
const saving = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const res = await http.get<{ user: any }>('/auth/me')
    const user = res.data.user
    form.value = { name: user.name || '', email: user.email, phone: user.phone || '' }
  } catch (e) {
    // 降级使用本地缓存
    form.value = { name: auth.user?.name || '', email: auth.user?.email || '', phone: '' }
  } finally {
    loading.value = false
  }
})

async function onSave() {
  saving.value = true
  try {
    await http.put('/config/profile', { name: form.value.name, phone: form.value.phone })
    await auth.refreshMe()
    emit('saved')
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    saving.value = false
  }
}
</script>
