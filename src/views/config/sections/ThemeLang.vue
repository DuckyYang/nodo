<template>
  <el-form :model="form" label-position="top" v-loading="loading">
    <el-form-item :label="t('config.themeDefault')">
      <el-radio-group v-model="form.themeDefault">
        <el-radio label="light">{{ t('config.light') }}</el-radio>
        <el-radio label="dark">{{ t('config.dark') }}</el-radio>
      </el-radio-group>
    </el-form-item>
    <el-form-item :label="t('config.followTime')">
      <div class="switch-row">
        <el-switch v-model="form.themeFollowTime" />
        <span class="tip">{{ t('config.followTimeTip') }}</span>
      </div>
    </el-form-item>
    <el-form-item :label="t('config.lang')">
      <el-radio-group v-model="form.langDefault">
        <el-radio label="zh">{{ t('config.chinese') }}</el-radio>
        <el-radio label="en">{{ t('config.english') }}</el-radio>
      </el-radio-group>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="saving" @click="onSave">{{ t('actions.save') }}</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { configApi } from '../../../api/config'
import { useThemeStore } from '../../../stores/theme'
import { useI18nStore } from '../../../stores/i18n'
import { useConfigStore } from '../../../stores/config'
import { apiError } from '../../../api/http'

const { t } = useI18n()
const theme = useThemeStore()
const i18n = useI18nStore()
const cfgStore = useConfigStore()
const form = ref<any>({ themeDefault: 'light', themeFollowTime: false, langDefault: 'zh' })
const loading = ref(false)
const saving = ref(false)
const emit = defineEmits<{ saved: [] }>()

onMounted(async () => {
  loading.value = true
  try {
    const cfg = await configApi.get()
    form.value = {
      // 历史数据兼容：曾存在 'auto'（跟随系统）选项，统一归一化为浅色
      themeDefault: cfg.themeDefault === 'dark' ? 'dark' : 'light',
      themeFollowTime: cfg.themeFollowTime,
      langDefault: cfg.langDefault === 'en' ? 'en' : 'zh'
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
    await configApi.updateUi(form.value)
    // 立即生效
    if (form.value.themeFollowTime) {
      theme.setFollowTime(true)
    } else {
      theme.setFollowTime(false)
      theme.setMode(form.value.themeDefault === 'dark' ? 'dark' : 'light')
    }
    if (form.value.langDefault === 'zh' || form.value.langDefault === 'en') {
      i18n.setLang(form.value.langDefault)
    }
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
/* 开关与说明文字同行水平居中对齐 */
.switch-row { display: flex; align-items: center; gap: 10px; }
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin: 0; line-height: 1.4; }
</style>
