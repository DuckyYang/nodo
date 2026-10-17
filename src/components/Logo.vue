<template>
  <div class="nodo-logo">
    <img :src="isDark ? darkLogoUrl : lightLogoUrl" alt="Nodo" :class="{ tall: !showText }" />
    <span class="nodo-logo-text" v-if="showText">{{ title }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '../stores/theme'
import lightLogoUrl from '../assets/logo-full-small-transparent-circles.png'
import darkLogoUrl from '../assets/logo-full-small-white-for-black.png'

const { t } = useI18n()
const theme = useThemeStore()
const isDark = computed(() => theme.mode === 'dark')
const props = withDefaults(defineProps<{ showText?: boolean }>(), { showText: false })
const title = t('app.title')
</script>

<style scoped>
.nodo-logo img { height: 28px; width: auto; object-fit: contain; }
.nodo-logo img.tall { height: 32px; }
.nodo-logo-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  letter-spacing: 1px;
}
</style>
