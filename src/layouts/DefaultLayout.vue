<template>
  <div class="nodo-app">
    <TopBar />
    <div class="nodo-content">
      <!-- keep-alive：模块间来回切换保留页面状态（列表/筛选/对话/抽屉等） -->
      <router-view v-slot="{ Component }">
        <keep-alive :include="keepAlivePages">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>
    <!-- 应用内待办提醒卡片（左下角轮播，与系统通知并行） -->
    <RemindCards />
    <!-- 右下角小助理快捷入口（仅待办/笔记页显示，全局挂载保持会话状态跨路由延续） -->
    <AssistantQuick v-if="showQuickAssistant" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from '../components/TopBar.vue'
import RemindCards from '../components/RemindCards.vue'
import AssistantQuick from '../components/AssistantQuick.vue'

const route = useRoute()
/** 悬浮球只在待办/笔记模块显示 */
const showQuickAssistant = computed(() => ['/todo', '/notes'].some((p) => route.path.startsWith(p)))

/** 参与 keep-alive 的页面（与组件 defineOptions name 对应） */
const keepAlivePages = ['TodoIndex', 'NotesIndex', 'AssistantIndex', 'MemoriesIndex', 'KnowledgeIndex', 'ConfigIndex']
</script>

<style scoped>
.nodo-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
