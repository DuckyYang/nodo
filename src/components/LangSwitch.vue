<template>
  <el-dropdown @command="onCommand">
    <button class="nodo-lang-btn" type="button" :title="t('lang.title')">
      <span class="lang-mark">{{ i18nStore.lang === 'zh' ? '中' : 'E' }}</span>
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="zh">{{ t('lang.zh') }}</el-dropdown-item>
        <el-dropdown-item command="en">{{ t('lang.en') }}</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useI18nStore } from '../stores/i18n'

const { t } = useI18n()
const i18nStore = useI18nStore()

function onCommand(cmd: string) {
  i18nStore.setLang(cmd as 'zh' | 'en')
}
</script>

<style scoped>
/* 与 ThemeSwitch 图标按钮同尺寸（32px 圆形），保证顶栏间距一致 */
.nodo-lang-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.nodo-lang-btn:hover {
  background: var(--el-fill-color-light);
}
</style>
