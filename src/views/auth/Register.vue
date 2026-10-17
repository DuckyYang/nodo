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
          <el-input v-model="form.email" type="email" :placeholder="t('auth.email')" />
        </el-form-item>
        <el-form-item :label="t('auth.name')" prop="name">
          <el-input v-model="form.name" :placeholder="t('auth.name')" />
        </el-form-item>
        <el-form-item :label="t('auth.password')" prop="password">
          <el-input v-model="form.password" type="password" show-password :placeholder="t('auth.password')" />
        </el-form-item>
        <el-form-item :label="t('auth.confirmPassword')" prop="confirm">
          <el-input v-model="form.confirm" type="password" show-password :placeholder="t('auth.confirmPassword')" @keyup.enter="onSubmit" />
        </el-form-item>
        <el-button type="primary" :loading="loading" class="auth-submit" @click="onSubmit">{{ t('auth.register') }}</el-button>
        <div class="auth-switch">
          <span>{{ t('auth.hasAccount') }}</span>
          <router-link to="/login">{{ t('auth.goLogin') }}</router-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import { apiError } from '../../api/http'
import { isStrongPassword } from '../../utils/strong-password'
import logoUrl from '../../assets/logo_small.png'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const form = ref({ email: '', name: '', password: '', confirm: '' })
const loading = ref(false)

const rules: FormRules = {
  email: [
    { required: true, message: t('auth.email'), trigger: 'blur' },
    { type: 'email', message: t('auth.email'), trigger: 'blur' }
  ],
  password: [
    { required: true, message: t('auth.password'), trigger: 'blur' },
    {
      validator: (_r, v: string, cb) => {
        if (!isStrongPassword(v)) cb(new Error(t('auth.weakPassword')))
        else cb()
      },
      trigger: 'blur'
    }
  ],
  confirm: [
    { required: true, message: t('auth.confirmPassword'), trigger: 'blur' },
    {
      validator: (_r, v: string, cb) => {
        if (v !== form.value.password) cb(new Error(t('auth.confirmPassword')))
        else cb()
      },
      trigger: 'blur'
    }
  ]
}

async function onSubmit() {
  if (!formRef.value) return
  const ok = await formRef.value.validate().catch(() => false)
  if (!ok) return
  loading.value = true
  try {
    await auth.register(form.value.email, form.value.password, form.value.name || undefined)
    ElMessage.success(t('toast.registerOk'))
    router.push('/todo')
  } catch (e) {
    ElMessage.error(apiError(e, t('auth.emailExists')))
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
.auth-switch { text-align: center; margin-top: 12px; font-size: 13px; }
.auth-switch a { margin-left: 8px; color: var(--el-color-primary); text-decoration: none; }
.auth-switch a:hover { text-decoration: underline; }
</style>
