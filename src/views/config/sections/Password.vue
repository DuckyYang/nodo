<template>
  <el-form :model="pwdForm" label-position="top" class="pwd-form">
    <el-form-item :label="t('auth.oldPassword')">
      <el-input v-model="pwdForm.oldPassword" type="password" show-password autocomplete="off" />
    </el-form-item>
    <el-form-item :label="t('auth.newPassword')">
      <el-input v-model="pwdForm.newPassword" type="password" show-password autocomplete="off" />
      <p class="pwd-tip">{{ t('auth.pwdRule') }}</p>
    </el-form-item>
    <el-form-item :label="t('auth.confirmPassword')">
      <el-input v-model="pwdForm.confirmPassword" type="password" show-password autocomplete="off" @keyup.enter="onChangePwd" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="changingPwd" @click="onChangePwd">{{ t('auth.changePassword') }}</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { http, apiError } from '../../../api/http'
import { useAuthStore } from '../../../stores/auth'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const changingPwd = ref(false)

async function onChangePwd() {
  const { oldPassword, newPassword, confirmPassword } = pwdForm
  if (!oldPassword || !newPassword || !confirmPassword) {
    ElMessage.warning(t('auth.pwdRequired'))
    return
  }
  if (newPassword !== confirmPassword) {
    ElMessage.warning(t('auth.pwdMismatch'))
    return
  }
  changingPwd.value = true
  try {
    await http.post('/auth/change-password', { oldPassword, newPassword })
    ElMessage.success(t('toast.pwdChanged'))
    // 密码已变更：登出当前会话，引导用新密码重新登录
    auth.logout()
    setTimeout(() => router.push('/login'), 800)
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    changingPwd.value = false
  }
}
</script>

<style scoped>
.pwd-form { max-width: 420px; }
.pwd-tip { color: var(--el-text-color-secondary); font-size: 12px; margin: 4px 0 0; line-height: 1.4; }
</style>
