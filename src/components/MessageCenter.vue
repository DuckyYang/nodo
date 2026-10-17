<template>
  <el-popover
    v-model:visible="visible"
    placement="bottom-end"
    :width="420"
    trigger="click"
    :offset="8"
    :show-arrow="false"
    popper-class="msg-center-popper"
    @show="onOpen"
  >
    <template #reference>
      <button class="msg-bell" type="button" :title="t('messages.title')">
        <el-badge :value="unread" :hidden="!unread" :max="99">
          <el-icon :size="18"><Bell /></el-icon>
        </el-badge>
      </button>
    </template>

    <div class="msg-center">
      <div class="msg-head">
        <span class="msg-title">{{ t('messages.title') }}</span>
        <div class="msg-head-actions">
          <el-button v-if="activeRead === 'unread'" link type="primary" size="small" @click="onMarkAllRead">
            {{ t('messages.markAllRead') }}
          </el-button>
          <el-button v-else link type="danger" size="small" @click="onClearRead">
            {{ t('messages.clearRead') }}
          </el-button>
        </div>
      </div>

      <!-- 未读 / 已读 tab -->
      <div class="msg-tabs">
        <button
          v-for="tab in (['unread', 'read'] as const)"
          :key="tab"
          class="msg-tab"
          :class="{ active: activeRead === tab }"
          type="button"
          @click="switchTab(tab)"
        >
          {{ t(`messages.${tab}`) }}
          <span v-if="tab === 'unread' && unread" class="msg-tab-count">{{ unread > 99 ? '99+' : unread }}</span>
        </button>
      </div>

      <!-- 分类筛选 + 检索 -->
      <div class="msg-toolbar">
        <el-select v-model="category" size="small" style="width: 120px" @change="reload">
          <el-option :label="t('messages.allCategories')" value="" />
          <el-option :label="t('messages.catTodo')" value="todo" />
          <el-option :label="t('messages.catAssistant')" value="assistant" />
        </el-select>
        <el-input
          v-model="keyword"
          size="small"
          clearable
          :placeholder="t('messages.searchPh')"
          :prefix-icon="Search"
          style="flex: 1"
          @input="debouncedReload"
        />
      </div>

      <!-- 消息列表：按 今日/本周/半年内/其它 分组 -->
      <div v-loading="loading" class="msg-list">
        <template v-if="grouped.length">
          <template v-for="g in grouped" :key="g.key">
            <div class="msg-group-label">{{ t(`messages.range.${g.key}`) }}</div>
            <div
              v-for="m in g.items"
              :key="m.id"
              class="msg-item"
              :class="{ unread: !m.read }"
              @click="onItemClick(m)"
            >
              <span class="msg-dot" />
              <div class="msg-item-main">
                <div class="msg-item-title">{{ m.title }}</div>
                <div class="msg-item-content">{{ m.content }}</div>
                <div class="msg-item-meta">
                  <el-tag size="small" effect="plain" round>{{ categoryLabel(m.category) }}</el-tag>
                  <span>{{ formatTime(m.createdAt) }}</span>
                </div>
              </div>
              <el-icon v-if="!m.read" class="msg-read-icon" :size="14" :title="t('messages.markRead')"><Check /></el-icon>
            </div>
          </template>
        </template>
        <div v-else-if="!loading" class="msg-empty">{{ t('messages.empty') }}</div>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Bell, Search, Check } from '@element-plus/icons-vue'
import { messageApi, type MessageDTO, type MessageCategory } from '../api/messages'
import { apiError } from '../api/http'
import { useAuthStore } from '../stores/auth'

/**
 * 顶栏消息中心（铃铛 + 红点 + 弹层）：
 * - 每 30 秒轮询未读数驱动红点（同时供 RemindCards 等模块刷新）
 * - 弹层内：未读/已读 tab、分类筛选（待办/小助理）、关键词检索
 * - 列表按 今日/本周/半年内/其它 分组
 * - 点击消息：未读 → 标记已读
 */

const { t } = useI18n()
const auth = useAuthStore()

const visible = ref(false)
const loading = ref(false)
const unread = ref(0)
const activeRead = ref<'unread' | 'read'>('unread')
const category = ref<'' | MessageCategory>('')
const keyword = ref('')
const list = ref<MessageDTO[]>([])

const POLL_INTERVAL = 30_000
let pollTimer: number | null = null

async function refreshUnread() {
  if (!auth.isAuthed) return
  try {
    unread.value = await messageApi.unreadCount()
  } catch { /* 静默 */ }
}

async function reload() {
  loading.value = true
  try {
    const res = await messageApi.list({
      read: activeRead.value,
      category: category.value || undefined,
      keyword: keyword.value.trim() || undefined,
      take: 100
    })
    list.value = res.list
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    loading.value = false
  }
}

/** 检索防抖 */
let debounceTimer: number | null = null
function debouncedReload() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(reload, 300)
}

function switchTab(tab: 'unread' | 'read') {
  activeRead.value = tab
  reload()
}

function onOpen() {
  reload()
  refreshUnread()
}

async function onItemClick(m: MessageDTO) {
  if (m.read) return
  try {
    await messageApi.markRead(m.id)
    m.read = true
    unread.value = Math.max(0, unread.value - 1)
    // 未读 tab 里已读的消息移出
    if (activeRead.value === 'unread') {
      list.value = list.value.filter((x) => x.id !== m.id)
      if (!list.value.length) await reload()
    }
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function onMarkAllRead() {
  try {
    await messageApi.markAllRead(category.value || undefined)
    unread.value = 0
    await reload()
    ElMessage.success(t('messages.allReadDone'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function onClearRead() {
  try {
    await messageApi.clearRead(category.value || undefined)
    await reload()
    ElMessage.success(t('toast.deleted'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

/** 列表按时间分组：今日 / 本周 / 半年内 / 其它 */
const grouped = computed(() => {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekStart = todayStart - 6 * 86400_000
  const halfYearStart = now.getTime() - 183 * 86400_000
  const buckets: Record<string, MessageDTO[]> = { today: [], week: [], halfYear: [], other: [] }
  for (const m of list.value) {
    const ts = new Date(m.createdAt).getTime()
    if (ts >= todayStart) buckets.today.push(m)
    else if (ts >= weekStart) buckets.week.push(m)
    else if (ts >= halfYearStart) buckets.halfYear.push(m)
    else buckets.other.push(m)
  }
  return (['today', 'week', 'halfYear', 'other'] as const)
    .map((key) => ({ key, items: buckets[key] }))
    .filter((g) => g.items.length > 0)
})

function categoryLabel(c: MessageCategory): string {
  return c === 'todo' ? t('messages.catTodo') : t('messages.catAssistant')
}

function formatTime(s: string): string {
  const d = new Date(s)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return hm
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

onMounted(() => {
  refreshUnread()
  pollTimer = window.setInterval(refreshUnread, POLL_INTERVAL)
  // 提醒卡片等其它模块处理消息后：刷新红点 + 若弹层开着同步刷新列表
  window.addEventListener('nodo:messages-changed', onMessagesChanged)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('nodo:messages-changed', onMessagesChanged)
})

/** 消息被外部（提醒卡片等）处理后的联动刷新 */
function onMessagesChanged() {
  refreshUnread()
  if (visible.value) reload()
}

/** 供 RemindCards 在卡片操作后同步刷新红点 */
defineExpose({ refreshUnread })
</script>

<style scoped>
.msg-bell {
  /* 与 ThemeSwitch / LangSwitch 图标按钮同尺寸（32px 圆形），保证顶栏对齐 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  color: var(--el-text-color-regular);
  transition: background 0.15s, color 0.15s;
}
.msg-bell:hover { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
/* el-badge 默认 inline-block 走文字基线对齐（图标下方多出下沉空间），改为 flex 居中 */
.msg-bell :deep(.el-badge) { display: inline-flex; align-items: center; line-height: 1; }
/* Bell 字形光学重心偏上（主体在上、底部小锤太轻），向下 1px 光学修正 */
.msg-bell :deep(.el-icon) { transform: translateY(1px); }

.msg-center { display: flex; flex-direction: column; max-height: 480px; }

.msg-head {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 8px; border-bottom: 1px solid var(--el-border-color-lighter);
}
.msg-title { font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); }

.msg-tabs { display: flex; gap: 4px; padding: 8px 0 6px; }
.msg-tab {
  border: none; background: transparent; cursor: pointer;
  padding: 4px 10px; border-radius: 6px; font-size: 13px;
  color: var(--el-text-color-regular); display: inline-flex; align-items: center; gap: 5px;
  transition: all 0.15s;
}
.msg-tab:hover { background: var(--el-fill-color-light); }
.msg-tab.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
.msg-tab-count {
  font-size: 11px; line-height: 1; padding: 2px 5px; border-radius: 999px;
  background: var(--el-color-danger); color: #fff;
}

.msg-toolbar { display: flex; gap: 8px; padding-bottom: 8px; }

.msg-list { flex: 1; overflow-y: auto; min-height: 120px; }
.msg-group-label {
  font-size: 12px; color: var(--el-text-color-secondary);
  padding: 8px 4px 4px; position: sticky; top: 0;
  background: var(--el-bg-color);
}
.msg-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
}
.msg-item:hover { background: var(--el-fill-color-light); }
.msg-dot {
  width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0;
  background: var(--el-fill-color); /* 已读：灰点 */
}
.msg-item.unread .msg-dot { background: var(--el-color-danger); }
.msg-item-main { flex: 1; min-width: 0; }
.msg-item-title {
  font-size: 13px; font-weight: 600; color: var(--el-text-color-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.msg-item.unread .msg-item-title { color: var(--el-color-primary); }
.msg-item-content {
  font-size: 12px; color: var(--el-text-color-regular); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin: 2px 0 4px;
}
.msg-item-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.msg-read-icon { color: var(--el-text-color-placeholder); margin-top: 4px; flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.msg-item:hover .msg-read-icon { opacity: 1; }
.msg-empty {
  padding: 32px 0; text-align: center; font-size: 13px; color: var(--el-text-color-placeholder);
}
</style>
