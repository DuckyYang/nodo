<template>
  <header class="nodo-topbar">
    <Logo />
    <nav class="nodo-menu">
      <button
        v-for="item in menus"
        :key="item.key"
        class="nodo-menu-item"
        :class="{ active: activeMenu === item.key }"
        type="button"
        @click="go(item.key)"
      >
        <el-icon :size="16"><component :is="item.icon" /></el-icon>
        <span>{{ t(item.label) }}</span>
      </button>
    </nav>
    <div class="nodo-actions">
      <MessageCenter />
      <ThemeSwitch />
      <LangSwitch />
      <UserMenu />
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Tickets, Folder, ChatDotRound, Collection, Reading } from '@element-plus/icons-vue'
import Logo from './Logo.vue'
import MessageCenter from './MessageCenter.vue'
import ThemeSwitch from './ThemeSwitch.vue'
import LangSwitch from './LangSwitch.vue'
import UserMenu from './UserMenu.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const activeMenu = ref<string>('todo')

const menus: { key: string; label: string; icon: Component }[] = [
  { key: 'todo', label: 'menu.todo', icon: Tickets },
  { key: 'notes', label: 'menu.notes', icon: Folder },
  { key: 'assistant', label: 'menu.assistant', icon: ChatDotRound },
  { key: 'memories', label: 'menu.memories', icon: Collection },
  { key: 'knowledge', label: 'menu.knowledge', icon: Reading }
]

function syncFromRoute() {
  if (menus.some((m) => m.key === route.name)) {
    activeMenu.value = route.name as string
  }
}
syncFromRoute()
watch(() => route.name, syncFromRoute)

function go(key: string) {
  router.push({ name: key })
}
</script>

<style scoped>
.nodo-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 14px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.nodo-menu-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.nodo-menu-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
html.dark .nodo-menu-item.active {
  background: var(--el-color-primary);
  color: #fff;
}
</style>
