<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <div class="auth-header">
        <img :src="logoUrl" class="auth-logo" />
        <div>
          <h2 class="auth-title">{{ t('app.title') }}</h2>
          <p class="auth-sub">{{ t('app.subtitle') }}</p>
        </div>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <el-form-item :label="t('auth.email')" prop="email">
          <el-input v-model="form.email" type="email" autocomplete="username" :placeholder="t('auth.email')" />
        </el-form-item>
        <el-form-item :label="t('auth.password')" prop="password">
          <el-input v-model="form.password" type="password" show-password autocomplete="current-password"
            :placeholder="t('auth.password')" @keyup.enter="onSubmit" />
        </el-form-item>
        <div class="auth-options">
          <el-checkbox v-model="rememberEmail" size="small">{{ t('auth.rememberEmail') }}</el-checkbox>
          <el-checkbox v-model="keepLogin" size="small">{{ t('auth.rememberDays') }}</el-checkbox>
          <el-select v-model="rememberDays" size="small" class="remember-select" :disabled="!keepLogin">
            <el-option :label="`7${t('auth.days')}`" :value="7" />
            <el-option :label="`15${t('auth.days')}`" :value="15" />
            <el-option :label="`30${t('auth.days')}`" :value="30" />
          </el-select>
        </div>
        <el-button type="primary" :loading="loading" class="auth-submit" @click="onSubmit">{{ t('auth.login') }}</el-button>
        <div class="auth-switch">
          <span>{{ t('auth.noAccount') }}</span>
          <router-link to="/register">{{ t('auth.goRegister') }}</router-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, type FormInstance } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import { apiError } from '../../api/http'
import logoUrl from '../../assets/logo_small.png'

const REMEMBER_EMAIL_KEY = 'nodo:rememberEmail'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const form = ref({ email: '', password: '' })
const loading = ref(false)
// 记住用户名（本地持久化，只存邮箱不存密码）
const rememberEmail = ref(!!localStorage.getItem(REMEMBER_EMAIL_KEY))
if (rememberEmail.value) form.value.email = localStorage.getItem(REMEMBER_EMAIL_KEY) || ''
// 免登录勾选 + 天数（默认 15 天，未勾选走默认有效期）
const keepLogin = ref(true)
const rememberDays = ref<number>(15)

const rules = {
  email: [
    { required: true, message: t('auth.email'), trigger: 'blur' },
    { type: 'email', message: t('auth.email'), trigger: 'blur' }
  ],
  password: [{ required: true, message: t('auth.password'), trigger: 'blur' }]
}

async function onSubmit() {
  if (!formRef.value) return
  const ok = await formRef.value.validate().catch(() => false)
  if (!ok) return
  loading.value = true
  try {
    // 勾选记住用户名：本地保存邮箱；未勾选：清除
    if (rememberEmail.value) localStorage.setItem(REMEMBER_EMAIL_KEY, form.value.email)
    else localStorage.removeItem(REMEMBER_EMAIL_KEY)
    await auth.login(form.value.email, form.value.password, keepLogin.value ? rememberDays.value : undefined)
    const redirect = (route.query.redirect as string) || '/todo'
    router.push(redirect)
  } catch (e) {
    ElMessage.error(apiError(e, t('auth.badCredentials')))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page {
  width: 100vw; height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(1200px 600px at 20% -10%, var(--el-color-primary-light-8), transparent 60%),
    radial-gradient(1000px 500px at 90% 110%, var(--el-color-primary-light-7), transparent 60%),
    var(--nodo-bg-page, #f5f7fa);
}
html.dark .auth-page {
  background:
    radial-gradient(1200px 600px at 20% -10%, rgba(64, 158, 255, 0.12), transparent 60%),
    radial-gradient(1000px 500px at 90% 110%, rgba(64, 158, 255, 0.08), transparent 60%),
    #141414;
}
.auth-card {
  width: 420px; max-width: 90vw;
  border-radius: 16px;
  border: 1px solid var(--el-border-color-lighter);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  padding: 8px;
}
html.dark .auth-card { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); }
.auth-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.auth-logo { width: 56px; height: 56px; border-radius: 14px; }
.auth-title { margin: 0; }
.auth-sub { color: var(--el-text-color-secondary); margin: 4px 0 0; font-size: 12px; }
.auth-submit { width: 100%; margin-top: 8px; height: 40px; }
.auth-options { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.remember-select { width: 92px; }
.auth-switch { text-align: center; margin-top: 12px; font-size: 13px; }
.auth-switch a { margin-left: 8px; color: var(--el-color-primary); text-decoration: none; }
.auth-switch a:hover { text-decoration: underline; }
</style>
