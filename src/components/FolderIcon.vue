<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <template v-if="!open">
      <!-- 关闭的文件夹：经典后片 + 前片 -->
      <path d="M3 8.5 a2 2 0 0 1 2-2 h7.5 l2.5 3 h12 a2 2 0 0 1 2 2 v13 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2-2 Z"
        fill="#f0b34c" />
      <path d="M3 13.5 h26 v11 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2-2 Z" fill="#f7c468" />
    </template>
    <template v-else>
      <!-- 打开的文件夹：上盖翻开 -->
      <path d="M3 8.5 a2 2 0 0 1 2-2 h7.5 l2.5 3 h12 a2 2 0 0 1 2 2 v2 H3 Z" fill="#e8a83c" />
      <path d="M1.5 15.5 h29 l-3 11.5 a2 2 0 0 1 -2 1.5 H5 a2 2 0 0 1 -2-2 Z" fill="#f7c468" />
      <path d="M1.5 13 h25 a1.6 1.6 0 0 1 1.6 2 l-1.6 10 H1.5 Z" fill="#ffd479" opacity="0.95" />
    </template>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ open?: boolean; size?: number }>(), { open: false, size: 22 })
</script>

<style scoped>
svg { flex-shrink: 0; }
</style>
