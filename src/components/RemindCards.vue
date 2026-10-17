<template>
  <div v-if="cards.length" class="remind-cards" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <div class="remind-card">
      <div class="card-head">
        <el-icon :size="16" class="card-bell"><Bell /></el-icon>
        <span class="card-title">{{ current.title }}</span>
        <el-tag v-if="cards.length > 1" size="small" type="info" effect="plain" round class="card-count">
          {{ index + 1 }} / {{ cards.length }}
        </el-tag>
        <button class="card-close" type="button" :title="t('remind.close')" @click="onClose(current)">
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>
      <div class="card-body">{{ current.body }}</div>
      <div class="card-actions">
        <button class="btn-mute" type="button" @click="onMute(current)">{{ t('remind.mute') }}</button>
        <button class="btn-close" type="button" @click="onClose(current)">{{ t('remind.close') }}</button>
      </div>
    </div>
    <!-- 轮播指示点（hover 时可点选） -->
    <div v-if="cards.length > 1" class="remind-dots">
      <span
        v-for="(c, i) in cards"
        :key="c.id"
        class="dot"
        :class="{ active: i === index }"
        @click="goTo(i)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Bell, Close } from '@element-plus/icons-vue'
import { todoApi, type RemindEventDTO } from '../api/todo'
import { messageApi } from '../api/messages'
import { apiError } from '../api/http'
import { useAuthStore } from '../stores/auth'

/**
 * 应用内提醒卡片（左下角持续显示）：
 * - 轮询拉取调度器触发的提醒事件（拉取即清空，前端持有展示权）
 * - 多条提醒轮播展示，每 5 秒切换；hover 暂停切换
 * - 「关闭」只关掉这张卡片（同步标记消息中心对应消息已读）
 * - 「不再提醒」关掉待办的提醒设置，并移除该待办的全部卡片（消息同步已读）
 * - 系统通知（Windows）由主进程独立下发，与本组件互不影响
 */

const { t } = useI18n()
const auth = useAuthStore()

const cards = ref<RemindEventDTO[]>([])
const index = ref(0)
const hovered = ref(false)

const current = computed(() => cards.value[index.value] || cards.value[0])

let pollTimer: number | null = null
let slideTimer: number | null = null
const POLL_INTERVAL = 10_000 // 轮询节奏（调度器分钟级扫描，10s 足够跟手）
const SLIDE_INTERVAL = 5_000 // 轮播切换间隔

async function poll() {
  if (!auth.isAuthed) return
  try {
    const list = await todoApi.listReminders()
    if (list.length) {
      // 追加展示（去重防止极端情况下重复拉到同一条）
      const known = new Set(cards.value.map((c) => c.id))
      const fresh = list.filter((c) => !known.has(c.id))
      if (fresh.length) cards.value.push(...fresh)
    }
  } catch {
    // 后端未就绪/网络抖动静默跳过，下一轮再试
  }
}

function goTo(i: number) {
  index.value = i
}

/** 消息中心联动：标记对应消息已读 + 刷新红点 */
function syncMessageRead(c: RemindEventDTO) {
  if (c.messageId != null) {
    messageApi.markRead(c.messageId).catch(() => {})
    window.dispatchEvent(new CustomEvent('nodo:messages-changed'))
  }
}

function onClose(c: RemindEventDTO) {
  const i = cards.value.findIndex((x) => x.id === c.id)
  if (i !== -1) cards.value.splice(i, 1)
  if (index.value >= cards.value.length) index.value = Math.max(0, cards.value.length - 1)
  syncMessageRead(c)
}

async function onMute(c: RemindEventDTO) {
  try {
    await todoApi.disableRemind(c.todoId)
    // 同一待办后续提醒不再弹卡片（对应消息一并标记已读）
    const removed = cards.value.filter((x) => x.todoId === c.todoId)
    cards.value = cards.value.filter((x) => x.todoId !== c.todoId)
    if (index.value >= cards.value.length) index.value = Math.max(0, cards.value.length - 1)
    for (const r of removed) syncMessageRead(r)
    // 待办数据已变更：通知待办列表刷新（编辑器打开时会重新拉取详情）
    window.dispatchEvent(new CustomEvent('nodo:todos-changed'))
    ElMessage.success(t('remind.muted'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

function slide() {
  if (hovered.value || cards.value.length < 2) return
  index.value = (index.value + 1) % cards.value.length
}

onMounted(() => {
  poll()
  pollTimer = window.setInterval(poll, POLL_INTERVAL)
  slideTimer = window.setInterval(slide, SLIDE_INTERVAL)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (slideTimer) clearInterval(slideTimer)
})
</script>

<style scoped>
/* 左下角悬浮提醒卡片容器 */
.remind-cards {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 2200; /* 高于 drawer(2000)，低于 message(2000+) 独立层级 */
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  animation: remind-in 0.25s ease-out;
}
@keyframes remind-in {
  from { transform: translateY(12px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.remind-card {
  width: 320px;
  max-width: calc(100vw - 40px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);
  overflow: hidden;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
}
.card-bell { color: var(--el-color-primary); flex-shrink: 0; }
.card-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-count { flex-shrink: 0; }
.card-close {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  color: var(--el-text-color-placeholder);
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  transition: all 0.15s;
}
.card-close:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }

.card-body {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-regular);
  word-break: break-all;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 0 12px 10px;
}
/* 「不再提醒」：醒目主色底 */
.btn-mute {
  border: none;
  cursor: pointer;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: #fff;
  background: var(--el-color-primary);
  transition: background 0.15s;
}
.btn-mute:hover { background: var(--el-color-primary-light-3); }
/* 「关闭」：白底描边（深色模式下浅底） */
.btn-close {
  border: 1px solid var(--el-border-color);
  cursor: pointer;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  background: #fff;
  transition: all 0.15s;
}
.btn-close:hover { color: var(--el-text-color-primary); border-color: var(--el-border-color-dark); }

/* 轮播指示点 */
.remind-dots {
  display: flex;
  gap: 6px;
  padding: 4px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  box-shadow: var(--el-box-shadow-lighter);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-text-color-disabled);
  cursor: pointer;
  transition: all 0.2s;
}
.dot.active { background: var(--el-color-primary); width: 16px; border-radius: 999px; }
</style>
