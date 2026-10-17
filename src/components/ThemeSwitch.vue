<template>
  <el-tooltip :content="theme.mode === 'dark' ? t('theme.light') : t('theme.dark')" placement="bottom">
    <button class="nodo-icon-btn" @click="toggle" type="button">
      <el-icon :size="18">
        <Sunny v-if="theme.mode === 'dark'" />
        <Moon v-else />
      </el-icon>
    </button>
  </el-tooltip>
</template>

<script setup lang="ts">
import { useThemeStore } from '../stores/theme'
import { useI18n } from 'vue-i18n'
import { Sunny, Moon } from '@element-plus/icons-vue'

const theme = useThemeStore()
const { t } = useI18n()

function toggle() {
  theme.setFollowTime(false)
  theme.setMode(theme.mode === 'dark' ? 'light' : 'dark')
}
</script>

<style scoped>
.nodo-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--el-text-color-primary);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.nodo-icon-btn:hover {
  background: var(--el-fill-color-light);
}
</style>
