<template>
  <el-config-provider :locale="elementLocale" :size="defaultSize" :message="messageConfig">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import { useConfigStore } from './stores/config'

const { locale } = useI18n()
const config = useConfigStore()
const elementLocale = computed(() => (locale.value === 'zh' ? zhCn : en))
const defaultSize = computed(() => (config.uiSize || 'default') as any)
// 全局消息配置：所有 ElMessage 默认右上角显示（组件原生支持，无需逐处传参）
const messageConfig = { placement: 'top-right' as const }
</script>
