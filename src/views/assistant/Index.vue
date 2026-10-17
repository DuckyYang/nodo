<template>
  <div class="nodo-page assistant-page">
    <!-- 左侧：会话历史 -->
    <aside class="session-bar">
      <button class="new-chat" type="button" @click="newChat">
        <el-icon><Plus /></el-icon>
        <span>{{ t('assistant.newChat') }}</span>
      </button>
      <div class="session-groups">
        <template v-for="g in sessionGroups" :key="g.key">
          <div v-if="g.items.length" class="group-label">{{ g.label }}</div>
          <div
            v-for="s in g.items"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === sessionId }"
            @click="openSession(s.id)"
          >
            <!-- 微信 ClawBot 渠道会话：绿色微信图标标识 -->
            <span v-if="s.source === 'wxclaw'" class="s-wx" :title="t('assistant.wxSessionTip')">
              <svg viewBox="0 0 1024 1024" width="12" height="12" fill="currentColor">
                <path d="M690.1 377.4c5.9 0 11.8.2 17.6.5-24.4-128.7-158.3-227.1-313.4-227.1C209 150.8 64 271.4 64 420.2c0 81.1 43.6 154.2 111.9 203.6l-28.1 84.4 98.2-49.2c35.4 9.9 67.6 19.8 103 19.8 5.6 0 11.2-.2 16.7-.6-3.5-18.2-5.5-36.9-5.5-56 0-156 134.4-284.2 329.9-284.2zM507.8 293.5c18.7 0 31.4 12.3 31.4 30.9 0 18.5-12.7 30.8-31.4 30.8-18.6 0-37.3-12.3-37.3-30.8 0-18.6 18.7-30.9 37.3-30.9zM288.2 355.2c-18.6 0-37.3-12.3-37.3-30.8 0-18.6 18.7-30.9 37.3-30.9 18.7 0 31.4 12.3 31.4 30.9 0 18.5-12.7 30.8-31.4 30.8zM959.5 622.7c0-124.9-124.6-226.5-265-226.5-148.4 0-265.4 101.6-265.4 226.5s117 226.5 265.4 226.5c31 0 62.3-7.8 93.4-15.6l85.3 46.8-23.4-77.9c62.4-46.7 109.7-109.9 109.7-179.8zM632.3 574.6c-12.4 0-24.9-12.3-24.9-24.7 0-12.3 12.5-24.6 24.9-24.6 18.7 0 31.2 12.3 31.2 24.6 0 12.4-12.5 24.7-31.2 24.7zM755.9 574.6c-12.3 0-24.7-12.3-24.7-24.7 0-12.3 12.4-24.6 24.7-24.6 18.6 0 31.2 12.3 31.2 24.6 0 12.4-12.6 24.7-31.2 24.7z"/>
              </svg>
            </span>
            <span class="s-title">{{ s.title || t('assistant.untitled') }}</span>
            <button class="s-del" type="button" :title="t('actions.delete')" @click.stop="delSession(s.id)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </template>
        <div v-if="!sessions.length" class="session-empty">{{ t('assistant.noHistory') }}</div>
        <!-- 查看全部：超过默认展示条数时显示 -->
        <button v-if="sessions.length > SESSION_LIMIT" class="view-all" type="button" @click="allSessionsOpen = true">
          <el-icon><List /></el-icon>
          <span>{{ t('assistant.viewAll') }}</span>
          <span class="view-all-count">{{ sessions.length }}</span>
        </button>
      </div>
    </aside>

    <!-- 右侧：对话区（复用对话核心组件） -->
    <div class="assistant-main">
      <!-- 微信渠道会话：只读（不能继续聊天，仅查看归档记录） -->
      <template v-if="sessionSource === 'wxclaw'">
        <div class="messages readonly-messages" ref="msgRef">
          <div v-for="m in wxMessages" :key="m.id" class="msg" :class="m.role">
            <div class="bubble">
              <span v-if="m.content">{{ m.content }}</span>
            </div>
          </div>
          <div v-if="!wxMessages.length" class="empty">{{ t('assistant.empty') }}</div>
        </div>
        <div class="composer readonly">
          <div class="composer-readonly-tip">
            <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
              <path d="M690.1 377.4c5.9 0 11.8.2 17.6.5-24.4-128.7-158.3-227.1-313.4-227.1C209 150.8 64 271.4 64 420.2c0 81.1 43.6 154.2 111.9 203.6l-28.1 84.4 98.2-49.2c35.4 9.9 67.6 19.8 103 19.8 5.6 0 11.2-.2 16.7-.6-3.5-18.2-5.5-36.9-5.5-56 0-156 134.4-284.2 329.9-284.2zM507.8 293.5c18.7 0 31.4 12.3 31.4 30.9 0 18.5-12.7 30.8-31.4 30.8-18.6 0-37.3-12.3-37.3-30.8 0-18.6 18.7-30.9 37.3-30.9zM288.2 355.2c-18.6 0-37.3-12.3-37.3-30.8 0-18.6 18.7-30.9 37.3-30.9 18.7 0 31.4 12.3 31.4 30.9 0 18.5-12.7 30.8-31.4 30.8zM959.5 622.7c0-124.9-124.6-226.5-265-226.5-148.4 0-265.4 101.6-265.4 226.5s117 226.5 265.4 226.5c31 0 62.3-7.8 93.4-15.6l85.3 46.8-23.4-77.9c62.4-46.7 109.7-109.9 109.7-179.8zM632.3 574.6c-12.4 0-24.9-12.3-24.9-24.7 0-12.3 12.5-24.6 24.9-24.6 18.7 0 31.2 12.3 31.2 24.6 0 12.4-12.5 24.7-31.2 24.7zM755.9 574.6c-12.3 0-24.7-12.3-24.7-24.7 0-12.3 12.4-24.6 24.7-24.6 18.6 0 31.2 12.3 31.2 24.6 0 12.4-12.6 24.7-31.2 24.7z"/>
            </svg>
            <span>{{ t('assistant.wxSessionReadonly') }}</span>
            <el-button size="small" type="primary" round @click="newChat">{{ t('assistant.newChat') }}</el-button>
          </div>
        </div>
      </template>
      <AssistantChat
        v-else
        ref="chatRef"
        :session-id="sessionId"
        @session="onSessionCreated"
        @sessions-changed="loadSessions"
      />
    </div>

    <!-- 查看全部会话：全量列表 + 检索 -->
    <el-drawer v-model="allSessionsOpen" :title="t('assistant.viewAll')" size="360px" append-to-body>
      <div class="all-sessions">
        <el-input
          v-model="allSessionSearch"
          class="all-search"
          :placeholder="t('assistant.searchSessions')"
          clearable
          :prefix-icon="Search"
        />
        <div class="all-list">
          <template v-for="g in allSessionGroups" :key="g.key">
            <div v-if="g.items.length" class="group-label">{{ g.label }}</div>
            <div
              v-for="s in g.items"
              :key="s.id"
              class="session-item"
              :class="{ active: s.id === sessionId }"
              @click="openSession(s.id); allSessionsOpen = false"
            >
              <!-- 微信 ClawBot 渠道会话：绿色微信图标标识 -->
              <span v-if="s.source === 'wxclaw'" class="s-wx" :title="t('assistant.wxSessionTip')">
                <svg viewBox="0 0 1024 1024" width="12" height="12" fill="currentColor">
                  <path d="M690.1 377.4c5.9 0 11.8.2 17.6.5-24.4-128.7-158.3-227.1-313.4-227.1C209 150.8 64 271.4 64 420.2c0 81.1 43.6 154.2 111.9 203.6l-28.1 84.4 98.2-49.2c35.4 9.9 67.6 19.8 103 19.8 5.6 0 11.2-.2 16.7-.6-3.5-18.2-5.5-36.9-5.5-56 0-156 134.4-284.2 329.9-284.2zM507.8 293.5c18.7 0 31.4 12.3 31.4 30.9 0 18.5-12.7 30.8-31.4 30.8-18.6 0-37.3-12.3-37.3-30.8 0-18.6 18.7-30.9 37.3-30.9zM288.2 355.2c-18.6 0-37.3-12.3-37.3-30.8 0-18.6 18.7-30.9 37.3-30.9 18.7 0 31.4 12.3 31.4 30.9 0 18.5-12.7 30.8-31.4 30.8zM959.5 622.7c0-124.9-124.6-226.5-265-226.5-148.4 0-265.4 101.6-265.4 226.5s117 226.5 265.4 226.5c31 0 62.3-7.8 93.4-15.6l85.3 46.8-23.4-77.9c62.4-46.7 109.7-109.9 109.7-179.8zM632.3 574.6c-12.4 0-24.9-12.3-24.9-24.7 0-12.3 12.5-24.6 24.9-24.6 18.7 0 31.2 12.3 31.2 24.6 0 12.4-12.5 24.7-31.2 24.7zM755.9 574.6c-12.3 0-24.7-12.3-24.7-24.7 0-12.3 12.4-24.6 24.7-24.6 18.6 0 31.2 12.3 31.2 24.6 0 12.4-12.6 24.7-31.2 24.7z"/>
                </svg>
              </span>
              <span class="s-title">{{ s.title || t('assistant.untitled') }}</span>
              <span class="s-time">{{ fmtSessionDate(s.updatedAt) }}</span>
              <button class="s-del" type="button" :title="t('actions.delete')" @click.stop="delSession(s.id)">
                <el-icon><Delete /></el-icon>
              </button>
            </div>
          </template>
          <div v-if="!allSessionGroups.some((g) => g.items.length)" class="session-empty">
            {{ allSessionSearch ? t('assistant.skills.noMatch') : t('assistant.noHistory') }}
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
/**
 * 小助理页面（全页版）：左侧会话历史 + 右侧对话核心（AssistantChat）。
 * 微信渠道会话为只读归档（不进对话核心，纯文本查看 + SSE 实时追加）。
 */
import { ref, computed, onMounted, onUnmounted, onActivated, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete, List, Search } from '@element-plus/icons-vue'
import { useAuthStore } from '../../stores/auth'
import { apiError } from '../../api/http'
import { assistantApi, type ChatSessionDTO } from '../../api/assistant'
import AssistantChat from '../../components/AssistantChat.vue'

defineOptions({ name: 'AssistantIndex' })

const { t } = useI18n()
const auth = useAuthStore()

const chatRef = ref<InstanceType<typeof AssistantChat>>()

// ---- 会话管理 ----
const sessions = ref<ChatSessionDTO[]>([])
const sessionId = ref<number | null>(null)
/** 当前会话来源：wxclaw = 微信渠道（只读，不能继续聊天） */
const sessionSource = ref<string>('app')
/** 侧栏默认展示的最近会话条数 */
const SESSION_LIMIT = 20

async function loadSessions() {
  try {
    sessions.value = await assistantApi.listSessions()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

/** 会话按时间分组：今日 / 本周 / 本月 / 更早 */
function groupSessions(list: ChatSessionDTO[]) {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = (now.getDay() + 6) % 7
  const startWeek = startToday - day * 86400_000
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const byGroup: Record<string, ChatSessionDTO[]> = { today: [], week: [], month: [], all: [] }
  for (const s of list) {
    const ts = new Date(s.updatedAt).getTime()
    if (ts >= startToday) byGroup.today.push(s)
    else if (ts >= startWeek) byGroup.week.push(s)
    else if (ts >= startMonth) byGroup.month.push(s)
    else byGroup.all.push(s)
  }
  return [
    { key: 'today', label: t('assistant.gToday'), items: byGroup.today },
    { key: 'week', label: t('assistant.gWeek'), items: byGroup.week },
    { key: 'month', label: t('assistant.gMonth'), items: byGroup.month },
    { key: 'all', label: t('assistant.gAll'), items: byGroup.all }
  ]
}

/** 侧栏默认：只展示最近 SESSION_LIMIT 条（已按 updatedAt 倒序） */
const sessionGroups = computed(() => groupSessions(sessions.value.slice(0, SESSION_LIMIT)))

// ---- 查看全部（全量列表 + 检索） ----
const allSessionsOpen = ref(false)
const allSessionSearch = ref('')

/** 全量会话分组：检索时按标题过滤 */
const allSessionGroups = computed(() => {
  const kw = allSessionSearch.value.trim().toLowerCase()
  const list = kw
    ? sessions.value.filter((s) => (s.title || '').toLowerCase().includes(kw))
    : sessions.value
  return groupSessions(list)
})

/** 抽屉里的会话日期：非今日显示 月-日，跨年显示 年-月-日 */
function fmtSessionDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function newChat() {
  sessionId.value = null
  sessionSource.value = 'app'
  chatRef.value?.reset()
}

/** 后端创建新会话：记录 id（AssistantChat 的 session 事件） */
function onSessionCreated(id: number) {
  if (sessionId.value !== id) sessionId.value = id
  loadSessions()
}

async function openSession(id: number) {
  try {
    const s = await assistantApi.getSession(id)
    sessionId.value = id
    sessionSource.value = s.source || 'app'
    if (s.source !== 'wxclaw') {
      // 普通会话：由对话核心加载历史（从微信只读视图切回时组件刚挂载，等一帧再调用）
      await nextTick()
      await chatRef.value?.loadHistory(id)
    } else {
      // 微信只读会话：本地渲染纯文本
      wxMessages.value = (s.messages || []).map((m, i) => ({ id: `h-${id}-${i}`, role: m.role, content: m.content }))
    }
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// ---- 微信渠道只读会话（纯文本消息 + SSE 实时追加） ----
const wxMessages = ref<{ id: string; role: string; content: string }[]>([])
const msgRef = ref<HTMLElement>()

let wxSse: { close: () => void } | null = null
let wxStreamingMsg: { sessionId: number; msg: { id: string; role: string; content: string } } | null = null

/** 订阅微信渠道事件流；仅在当前打开的是微信会话时保持连接 */
async function subscribeWxEvents() {
  wxSse?.close()
  wxSse = null
  wxStreamingMsg = null
  if (sessionSource.value !== 'wxclaw' || !auth.token) return
  try {
    const port = await window.nodo.getServerPort()
    const es = new EventSource(`http://127.0.0.1:${port}/assistant/wx-events?token=${encodeURIComponent(auth.token)}`)
    es.onerror = () => { /* 自动重连由浏览器处理 */ }
    wxSse = es

    es.addEventListener('wx_message', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data)
      if (d.sessionId === sessionId.value) {
        wxMessages.value.push({ id: newId(), role: 'user', content: d.text })
        scrollBottom()
        loadSessions().catch(() => {})
      }
    })
    es.addEventListener('wx_token', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data)
      if (d.sessionId !== sessionId.value) return
      ensureWxStreamingMsg(d.sessionId)
      wxStreamingMsg!.msg.content += d.v
      scrollBottom()
    })
    es.addEventListener('wx_thought', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data)
      if (d.sessionId !== sessionId.value) return
      ensureWxStreamingMsg(d.sessionId)
      // 只读视图不渲染思考过程，保持纯文本
    })
    es.addEventListener('wx_tool', () => { /* 只读视图不渲染工具 */ })
    es.addEventListener('wx_done', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data)
      const cur = wxStreamingMsg
      if (cur && cur.sessionId === d.sessionId) {
        wxStreamingMsg = null
        loadSessions().catch(() => {})
      }
    })
    es.addEventListener('wx_error', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data)
      if (d.sessionId !== sessionId.value) return
      wxStreamingMsg = null
      ElMessage.error(d.message || t('assistant.requestFailed'))
    })
  } catch { /* 连接失败：保持只读展示，不阻塞 */ }
}

function newId() { return `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }

/** 微信流事件到达时若无进行中的 AI 消息则创建 */
function ensureWxStreamingMsg(sid: number) {
  if (wxStreamingMsg?.sessionId === sid) return
  const msg = { id: newId(), role: 'assistant', content: '' }
  wxMessages.value.push(msg)
  wxStreamingMsg = { sessionId: sid, msg }
}

async function scrollBottom() {
  await new Promise((r) => setTimeout(r, 0))
  if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
}

/** 会话切换 / 新建时刷新微信事件订阅 */
watch([sessionId, sessionSource], () => subscribeWxEvents())
onUnmounted(() => {
  wxSse?.close()
  wxSse = null
})

async function delSession(id: number) {
  try {
    await ElMessageBox.confirm(t('assistant.delSessionConfirm'), t('assistant.delSession'), {
      type: 'warning',
      confirmButtonText: t('actions.delete'),
      cancelButtonText: t('actions.cancel')
    })
  } catch {
    return
  }
  try {
    await assistantApi.deleteSession(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (sessionId.value === id) newChat()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

onMounted(loadSessions)

/** keep-alive 切回：刷新会话列表（保留当前对话内容与输入状态） */
onActivated(loadSessions)
</script>

<style scoped>
.assistant-page { flex-direction: row; }
/* 左侧会话栏 */
.session-bar {
  width: 240px; flex-shrink: 0; display: flex; flex-direction: column;
  border-right: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.new-chat {
  margin: 12px; padding: 8px 12px; display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--el-border-color); border-radius: 8px;
  background: var(--el-color-primary); color: #fff; font-size: 13px; cursor: pointer;
}
.new-chat:hover { opacity: 0.9; }
.session-groups { flex: 1; overflow: auto; padding: 0 8px 12px; }
.group-label {
  font-size: 11px; color: var(--el-text-color-secondary);
  padding: 10px 6px 4px;
}
.session-item {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
  color: var(--el-text-color-regular);
}
.session-item:hover { background: var(--el-fill-color-light); }
.session-item.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 500; }
.s-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 微信 ClawBot 渠道会话标识（绿色微信图标） */
.s-wx {
  flex: none; display: inline-flex; align-items: center;
  color: #07c160;
  margin-right: 2px;
}
.s-del {
  border: none; background: transparent; padding: 2px; color: var(--el-text-color-secondary);
  cursor: pointer; opacity: 0; flex-shrink: 0;
}
.session-item:hover .s-del { opacity: 1; }
.s-del:hover { color: var(--el-color-danger); }
.session-empty { padding: 20px 8px; font-size: 12px; color: var(--el-text-color-secondary); text-align: center; }

/* 查看全部按钮（侧栏底部） */
.view-all {
  display: flex; align-items: center; gap: 6px;
  width: 100%; margin-top: 6px; padding: 8px 10px;
  border: none; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--el-text-color-secondary); font-size: 12px;
  transition: background-color 0.2s, color 0.2s;
}
.view-all:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.view-all-count { margin-left: auto; font-size: 11px; }

/* 查看全部抽屉 */
.all-sessions { display: flex; flex-direction: column; height: 100%; }
.all-search { margin-bottom: 10px; flex-shrink: 0; }
.all-list { flex: 1; overflow-y: auto; padding: 0 4px; }
.all-list .group-label { padding: 10px 6px 4px; }
.all-list .s-time { flex-shrink: 0; font-size: 11px; color: var(--el-text-color-placeholder); }

.assistant-main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
/* 微信只读会话的消息区（复用对话核心同款排版） */
.readonly-messages {
  flex: 1; overflow: auto; padding: 20px 24px;
  display: flex; flex-direction: column; gap: 14px;
}
.readonly-messages .msg { display: flex; }
.readonly-messages .msg.user { justify-content: flex-end; }
.readonly-messages .msg.user .bubble {
  max-width: 70%; border-radius: 12px;
  background: var(--el-color-primary); color: #fff;
}
.readonly-messages .msg.assistant .bubble {
  max-width: none; min-width: 40%;
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
}
.readonly-messages .bubble { padding: 10px 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.readonly-messages .empty { color: var(--el-text-color-secondary); text-align: center; margin: auto; }
.composer { padding: 12px 24px 16px; border-top: 1px solid var(--el-border-color); }
.composer.readonly { padding: 10px 24px; }
.composer-readonly-tip {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary); font-size: 13px;
  line-height: 24px;
}
.composer-readonly-tip svg { color: #07c160; flex: none; }
.composer-readonly-tip .el-button { flex: none; height: 24px; padding: 0 12px; }
</style>
