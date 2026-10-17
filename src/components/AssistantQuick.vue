<template>
  <!-- 右下角悬浮球：快速发起小助理对话（仅待办/笔记模块显示） -->
  <div ref="rootRef" class="assistant-quick">
    <Transition name="quick-pop">
      <div v-if="open" class="quick-panel">
        <div class="quick-head">
          <span class="quick-title">{{ t('assistant.quickTitle') }}</span>
          <button class="quick-new" type="button" :title="t('assistant.newChat')" @click="onNewChat">
            <el-icon :size="15"><Plus /></el-icon>
          </button>
          <button class="quick-close" type="button" :title="t('actions.close')" @click="open = false">
            <el-icon :size="14"><Close /></el-icon>
          </button>
        </div>
        <AssistantChat ref="chatRef" compact :session-id="sessionId" :source="channel" @session="onSession" />
      </div>
    </Transition>
    <button class="quick-fab" type="button" :title="t('assistant.quickTip')" @click="toggle">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <!-- 简约气泡：圆角对话气泡 + 三点 -->
        <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.4L5.7 20.7c-.6.6-1.7.2-1.7-.7v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h2a1 1 0 0 1 1 1v1.6l2.3-2.3a1 1 0 0 1 .7-.3H20V6H4zm4 4.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm4 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm4 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 待办/笔记模块右下角的小助理快捷入口：
 * - 悬浮球：点击展开小尺寸对话弹层（再次点击收起）
 * - 弹层内嵌 AssistantChat（compact 模式）：
 *   首次打开自动加载该页面最近一次的 app 会话（待办/笔记各自独立记忆），
 *   弹层头部有「新对话」按钮
 * - 后端会话按渠道区分：chat 路由带 source 参数（quick_todo / quick_notes）
 */
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Close, Plus } from '@element-plus/icons-vue'
import { assistantApi } from '../api/assistant'
import AssistantChat from './AssistantChat.vue'

const { t } = useI18n()
const route = useRoute()

const open = ref(false)
/** 各渠道的会话状态：sessionId + 是否已初始化（待办/笔记各自独立记忆） */
interface ChannelState { sessionId: number | null; loaded: boolean }
const states: Record<string, ChannelState> = {
  quick_todo: { sessionId: null, loaded: false },
  quick_notes: { sessionId: null, loaded: false }
}
const sessionId = ref<number | null>(null)
const chatRef = ref<InstanceType<typeof AssistantChat>>()
/** 组件根节点（悬浮球 + 弹层），用于判断点击是否在组件外部 */
const rootRef = ref<HTMLElement>()

/** 当前渠道：待办页 quick_todo / 笔记页 quick_notes（两页面各自独立对话） */
const channel = computed<'quick_todo' | 'quick_notes'>(() =>
  route.path.startsWith('/notes') ? 'quick_notes' : 'quick_todo'
)

/** 页面切换：各自渠道的会话 id 互不干扰 */
watch(channel, (c) => {
  sessionId.value = states[c].sessionId
})

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  const st = states[channel.value]
  sessionId.value = st.sessionId
  // 等弹层与 AssistantChat 挂载完成（v-if 渲染），chatRef 才可用
  await nextTick()
  if (st.sessionId) {
    // 已有会话：每次打开都重新加载历史
    // （弹层关闭时 AssistantChat 被 v-if 销毁，内存消息丢失，必须重拉）
    await chatRef.value?.loadHistory(st.sessionId)
    return
  }
  if (st.loaded) return
  st.loaded = true
  // 该渠道还没有会话：首次打开时查找此渠道最近一次会话（无则空白新对话）
  try {
    const list = await assistantApi.listSessions()
    const latest = list.find((s) => s.source === channel.value)
    if (latest) {
      st.sessionId = latest.id
      sessionId.value = latest.id
      await chatRef.value?.loadHistory(latest.id)
    }
  } catch { /* 拉取失败：保持新对话 */ }
}

/** 弹层内新对话：清空消息 + 重置该渠道会话 id */
function onNewChat() {
  sessionId.value = null
  states[channel.value].sessionId = null
  chatRef.value?.reset()
}

/** 后端首次创建会话：记录到当前渠道供续聊与停止 */
function onSession(id: number) {
  states[channel.value].sessionId = id
  if (sessionId.value !== id) {
    sessionId.value = id
  }
}

/** 点击弹层外部的空白处关闭（悬浮球和弹层内部点击除外） */
function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const root = rootRef.value
  if (root && !root.contains(e.target as Node)) {
    open.value = false
  }
}

// 离开待办/笔记模块时收起弹层（悬浮球本身也只在路由允许时渲染）
watch(
  () => route.path,
  () => { open.value = false }
)

onMounted(() => document.addEventListener('mousedown', onDocClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocClick))

defineExpose({ open })
</script>

<style scoped>
/* 悬浮球：右下角固定，避开提醒卡片（左下角） */
.quick-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 48px; height: 48px;
  border: none; border-radius: 50%;
  cursor: pointer;
  background: var(--el-color-primary);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 90;
}
.quick-fab:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);
}
.quick-fab:active { transform: scale(0.96); }

/* 弹层：悬浮球上方，小尺寸（420x520），不遮挡主内容 */
.quick-panel {
  position: fixed;
  right: 24px;
  bottom: 84px;
  width: 420px;
  height: 520px;
  display: flex; flex-direction: column;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  z-index: 90;
}
.quick-head {
  display: flex; align-items: center;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}
.quick-title {
  flex: 1;
  font-size: 13px; font-weight: 600;
  color: var(--el-text-color-primary);
}
/* 新对话按钮：主题色，区别于关闭 */
.quick-new {
  width: 26px; height: 26px;
  border: none; border-radius: 6px; cursor: pointer;
  background: transparent;
  color: var(--el-color-primary);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background-color 0.15s;
}
.quick-new:hover { background: var(--el-color-primary-light-9); }
.quick-close {
  width: 26px; height: 26px;
  border: none; border-radius: 6px; cursor: pointer;
  background: transparent;
  color: var(--el-text-color-secondary);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background-color 0.15s, color 0.15s;
}
.quick-close:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.quick-panel :deep(.chat-core) { flex: 1; }

/* 出入场：右下角轻弹出 */
.quick-pop-enter-active, .quick-pop-leave-active { transition: all 0.2s ease; }
.quick-pop-enter-from, .quick-pop-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
  transform-origin: bottom right;
}
</style>
