<template>
  <div class="chat-core" :class="{ compact: compact }">
    <!-- 对话区 -->
    <div class="messages" ref="msgRef">
      <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
        <div class="bubble">
          <!-- AI 思考过程折叠面板：timeline 中除最终总结外的所有段 -->
          <div
            v-if="m.role === 'assistant' && splitMsg(m).thoughtTl.length"
            class="thought"
            :class="{ open: thoughtOpen[m.id] }"
          >
            <button class="thought-head" type="button" @click="thoughtOpen[m.id] = !thoughtOpen[m.id]">
              <el-icon class="thought-icon" :class="{ 'is-loading': m.streaming }">
                <Loading v-if="m.streaming" /><CaretRight v-else />
              </el-icon>
              <span class="thought-label">{{ m.streaming ? t('assistant.thinking') : t('assistant.thoughtDone') }}</span>
              <span v-if="!thoughtOpen[m.id] && m.streaming" class="thought-preview">{{ tlPreview(m) }}</span>
              <span v-if="!thoughtOpen[m.id] && tlRunningTool(m)" class="thought-tool">{{ t('assistant.toolCalling', { tool: tlRunningTool(m) }) }}</span>
            </button>
            <div v-show="thoughtOpen[m.id]" class="thought-body">
              <template v-for="(seg, i) in splitMsg(m).thoughtTl" :key="i">
                <div v-if="seg.type === 'reasoning' && (seg.text || '').trim()" class="tl-seg tl-reasoning">{{ collapseBlanks(seg.text || '') }}</div>
                <div v-else-if="seg.type === 'content' && (seg.text || '').trim()" class="tl-seg tl-content" v-html="renderMdCompact(seg.text || '')"></div>
                <div v-else-if="seg.type === 'tool'" class="tl-seg tl-tool">
                  <div class="tool-card" :class="{ open: toolOpen[m.id + '-' + i] }" @click="toolOpen[m.id + '-' + i] = !toolOpen[m.id + '-' + i]">
                    <div class="tool-head clickable">
                      <el-icon class="tool-caret" :class="{ rot: toolOpen[m.id + '-' + i] }"><CaretRight /></el-icon>
                      <span class="tool-name">{{ seg.tool }}</span>
                      <span v-if="seg.tool !== 'write_todos'" class="tool-status" :class="seg.output ? 'ok' : 'running'">
                        {{ seg.output ? t('assistant.toolDone') : t('assistant.toolRunning') }}
                      </span>
                    </div>
                    <div v-show="toolOpen[m.id + '-' + i]" class="tool-body">
                      <div v-if="seg.input" class="tool-sec">
                        <div class="tool-sec-label">{{ t('assistant.toolInput') }}</div>
                        <pre>{{ fmtJson(seg.input) }}</pre>
                      </div>
                      <div v-if="seg.output" class="tool-sec">
                        <div class="tool-sec-label">{{ t('assistant.toolOutput') }}</div>
                        <pre>{{ fmtJson(seg.output) }}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <!-- 待办清单：write_todos 生成的任务列表 -->
          <div v-if="m.role === 'assistant' && msgTodos(m)" class="todo-list">
            <div class="todo-list-title">
              <el-icon><List /></el-icon>
              <span>{{ t('assistant.todoList') }}</span>
              <span class="todo-count">{{ msgTodos(m)!.filter((x) => x.status === 'completed').length }}/{{ msgTodos(m)!.length }}</span>
            </div>
            <div
              v-for="(todo, ti) in msgTodos(m)!"
              :key="ti"
              class="todo-item"
              :class="m.streaming ? todo.status : 'completed'"
            >
              <span class="todo-check"></span>
              <span class="todo-text">{{ todo.content }}</span>
            </div>
          </div>
          <!-- 最终总结 -->
          <div
            v-if="m.role === 'assistant' && splitMsg(m).finalText"
            class="md"
            :class="{ typing: m.streaming }"
            v-html="renderMd(splitMsg(m).finalText)"
          ></div>
          <span v-else-if="m.role === 'user' && m.content">{{ m.content }}</span>
          <!-- HITL 决策记录 -->
          <div v-if="m.role === 'assistant' && m.hitl && m.hitl.decision" class="hitl-record" :class="m.hitl.decision">
            <el-icon class="hitl-record-icon">
              <CircleCheckFilled v-if="m.hitl.decision === 'approve'" />
              <CircleCloseFilled v-else-if="m.hitl.decision === 'reject'" />
              <Clock v-else />
            </el-icon>
            <span class="hitl-record-badge">{{ hitlDecisionText(m.hitl.decision) }}</span>
            <span class="hitl-record-prompt" :title="m.hitl.prompt">{{ m.hitl.prompt }}</span>
          </div>
          <!-- AI 气泡底部：完成时间 + token 消耗 + 记忆/知识更新状态 -->
          <div v-if="m.role === 'assistant' && !m.streaming && (m.finishedAt || m.usage || m.memoryStatus || m.knowledgeStatus)" class="msg-meta">
            <span v-if="m.finishedAt">{{ m.finishedAt }}</span>
            <span v-if="m.usage">↑ {{ fmtNum(m.usage.input) }} · ↓ {{ fmtNum(m.usage.output) }} tokens</span>
            <span v-if="m.memoryStatus === 'running'" class="mem-status running">
              <el-icon :size="11" class="rotating"><Loading /></el-icon>{{ t('assistant.memoryUpdating') }}
            </span>
            <span v-else-if="m.memoryStatus === 'done'" class="mem-status done" :title="m.memoryDetail">
              <el-icon :size="11"><CircleCheckFilled /></el-icon>{{ t('assistant.memoryUpdated') }}{{ m.memoryDetail ? `（${m.memoryDetail}）` : '' }}
            </span>
            <span v-else-if="m.memoryStatus === 'error'" class="mem-status error" :title="m.memoryDetail">
              <el-icon :size="11"><CircleCloseFilled /></el-icon>{{ t('assistant.memoryUpdateFail') }}
            </span>
            <span v-if="m.knowledgeStatus === 'running'" class="mem-status running">
              <el-icon :size="11" class="rotating"><Loading /></el-icon>{{ t('assistant.knowledgeUpdating') }}
            </span>
            <span v-else-if="m.knowledgeStatus === 'done'" class="mem-status done" :title="m.knowledgeDetail">
              <el-icon :size="11"><CircleCheckFilled /></el-icon>{{ t('assistant.knowledgeUpdated') }}{{ m.knowledgeDetail ? `（${m.knowledgeDetail}）` : '' }}
            </span>
            <span v-else-if="m.knowledgeStatus === 'error'" class="mem-status error" :title="m.knowledgeDetail">
              <el-icon :size="11"><CircleCloseFilled /></el-icon>{{ t('assistant.knowledgeUpdateFail') }}
            </span>
          </div>
          <!-- 用户消息附件 -->
          <div v-if="m.attachments && m.attachments.length" class="att-list msg-atts">
            <div v-for="a in m.attachments" :key="a.relPath" class="att-chip">
              <div class="att-thumb">
                <el-icon><Document /></el-icon>
              </div>
              <div class="att-meta">
                <div class="att-name" :title="a.name">{{ a.name }}</div>
                <div class="att-sub">{{ extOf(a.name) }} {{ fmtSize(a.size) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="messages.length === 0" class="empty">{{ t('assistant.empty') }}</div>
    </div>
    <!-- 输入区 -->
    <div class="composer">
      <!-- HITL 悬浮确认栏 -->
      <Transition name="hitl-pop">
        <div v-if="pendingHitl" class="hitl-bar">
          <div class="hitl-bar-inner">
            <div class="hitl-bar-icon">
              <el-icon><WarningFilled /></el-icon>
            </div>
            <div class="hitl-bar-text">
              <div class="hitl-bar-title">{{ t('assistant.hitlTitle') }}</div>
              <div class="hitl-bar-desc" :title="pendingHitl.prompt">{{ pendingHitl.prompt }}</div>
            </div>
            <div class="hitl-bar-actions">
              <button class="hitl-btn primary" type="button" :disabled="hitlLoading" @click="onHitlDecision(pendingHitl, 'approve')">
                {{ t('assistant.hitlConfirm') }}
              </button>
              <button class="hitl-btn danger" type="button" :disabled="hitlLoading" @click="onHitlDecision(pendingHitl, 'reject')">
                {{ t('assistant.hitlDeny') }}
              </button>
              <button class="hitl-btn" type="button" :disabled="hitlLoading" @click="onHitlDecision(pendingHitl, 'ignore')">
                {{ t('assistant.hitlIgnore') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
      <div class="composer-card" :class="{ focused: composerFocus }">
        <!-- 已选附件 -->
        <div v-if="attachments.length" class="att-list">
          <div v-for="(a, i) in attachments" :key="a.relPath" class="att-chip">
            <div class="att-thumb">
              <el-icon><Document /></el-icon>
            </div>
            <div class="att-meta">
              <div class="att-name" :title="a.name">{{ a.name }}</div>
              <div class="att-sub">{{ extOf(a.name) }} {{ fmtSize(a.size) }}</div>
            </div>
            <button class="att-del" type="button" @click="attachments.splice(i, 1)">×</button>
          </div>
        </div>
        <!-- 已激活技能 -->
        <div v-if="selectedSkill" class="active-skill-row">
          <div class="active-skill-chip">
            <el-icon :size="13"><MagicStick /></el-icon>
            <span class="active-skill-name">{{ selectedSkill.name }}</span>
            <span class="active-skill-desc">{{ selectedSkill.description }}</span>
            <button class="active-skill-del" type="button" @click="clearSelectedSkill">×</button>
          </div>
        </div>
        <!-- 技能选择面板 -->
        <div v-if="skillPanelVisible" class="skill-panel" @mousedown.stop>
          <div class="skill-panel-head">
            <span class="skill-panel-title">{{ t('assistant.skills.pickTitle') }}</span>
          </div>
          <div class="skill-panel-search">
            <input
              ref="skillSearchRef"
              v-model="skillSearch"
              class="skill-search-input"
              :placeholder="t('assistant.skills.searchPh')"
              @keydown.enter.prevent="onSkillSearchEnter"
              @keydown.esc.stop.prevent="closeSkillPanel"
            />
          </div>
          <div class="skill-panel-list">
            <button
              v-for="s in filteredSkills"
              :key="s.dirName"
              class="skill-option"
              type="button"
              @mousedown.prevent
              @click="pickSkill(s)"
            >
              <span class="skill-option-name">{{ s.name }}</span>
              <span class="skill-option-desc">{{ s.description }}</span>
            </button>
            <div v-if="!filteredSkills.length" class="skill-panel-empty">{{ t('assistant.skills.noMatch') }}</div>
          </div>
        </div>
        <textarea
          ref="composerRef"
          v-model="input"
          class="composer-input"
          rows="2"
          :placeholder="t('assistant.placeholder')"
          :disabled="sending"
          @focus="composerFocus = true"
          @blur="composerFocus = false"
          @keydown.enter.exact.prevent="onSend"
          @keydown.shift.enter.exact.prevent
          @keydown.esc.stop="closeSkillPanel"
        />
        <div class="composer-actions">
          <!-- 加号下拉：上传文件、技能管理、三项功能开关（点击切换，末尾打勾代表启用） -->
          <el-dropdown trigger="click" @command="onPlusCommand">
            <button class="icon-btn" type="button" :disabled="sending || uploading" :title="t('assistant.moreTools')">
              <el-icon><Plus /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu class="plus-dropdown-menu">
                <el-dropdown-item command="upload">
                  <el-icon><Document /></el-icon>
                  <span class="plus-menu-label">{{ t('assistant.uploadFile') }}</span>
                </el-dropdown-item>
                <el-dropdown-item command="skills">
                  <el-icon><MagicStick /></el-icon>
                  <span class="plus-menu-label">{{ t('assistant.skills.manage') }}</span>
                </el-dropdown-item>
                <div class="plus-dropdown-divider" />
                <el-dropdown-item command="websearch" :class="{ 'is-on': webSearchEnabled }">
                  <el-icon><Search /></el-icon>
                  <span class="plus-menu-label">{{ t('assistant.webSearch') }}</span>
                  <span class="plus-menu-check"><el-icon v-if="webSearchEnabled"><Check /></el-icon></span>
                </el-dropdown-item>
                <el-dropdown-item command="knowledge" :class="{ 'is-on': knowledgeEnabled }">
                  <el-icon><Reading /></el-icon>
                  <span class="plus-menu-label">{{ t('assistant.knowledge') }}</span>
                  <span class="plus-menu-check"><el-icon v-if="knowledgeEnabled"><Check /></el-icon></span>
                </el-dropdown-item>
                <el-dropdown-item command="memory" :disabled="!!props.sessionId" :class="{ 'is-on': memoryEnabled }">
                  <el-icon><Collection /></el-icon>
                  <span class="plus-menu-label">{{ t('assistant.memory') }}</span>
                  <span class="plus-menu-check"><el-icon v-if="memoryEnabled"><Check /></el-icon></span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <!-- 当前工作目录（加号右侧） -->
          <div v-if="workDir && !compact" class="workdir-chip">
            <button class="workdir-main" type="button" :title="t('assistant.openUploadDir')" @click="openUploadDir">
              <el-icon :size="13"><FolderOpened /></el-icon>
              <span class="workdir-label">{{ t('assistant.workDirLabel') }}：</span>
            </button>
            <button class="workdir-path" type="button" :title="workDir" @click="onChangeWorkDir">
              <span class="workdir-name">{{ workDir }}</span>
            </button>
          </div>
          <div class="composer-spacer" />
          <!-- 模型选择（发送按钮左侧；仅 chat 模型；每个会话固定，新会话默认沿用最近选择） -->
          <el-dropdown v-if="chatModels.length" trigger="click" :disabled="!!props.sessionId" @command="onPickModel">
            <button class="model-pick" type="button" :class="{ locked: !!props.sessionId }" :title="props.sessionId ? t('assistant.modelLockedTip') : t('assistant.pickModelTip')">
              <el-icon :size="13"><Cpu /></el-icon>
              <span class="model-pick-name">{{ currentModelName }}</span>
              <el-icon v-if="!props.sessionId" :size="10"><CaretBottom /></el-icon>
              <el-icon v-else :size="10"><Lock /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="m in chatModels" :key="m.id" :class="{ active: m.id === selectedModelId }" :command="m.id">
                  <span class="model-menu-name">{{ m.name }}</span>
                  <span v-if="m.id === selectedModelId" class="model-menu-check"><el-icon :size="12"><Check /></el-icon></span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button v-if="sending" class="send-btn stop" type="button" :title="t('assistant.stop')" @click="onStop">
            <el-icon><VideoPause /></el-icon>
          </button>
          <button
            v-else
            class="send-btn"
            type="button"
            :title="t('assistant.send')"
            :disabled="!input.trim() && !attachments.length"
            @click="onSend"
          >
            <el-icon><Top /></el-icon>
          </button>
        </div>
      </div>
    </div>

    <!-- 技能管理弹窗 -->
    <el-dialog v-model="skillsDialog" :title="t('assistant.skills.manage')" width="560px" append-to-body>
      <div class="skills-toolbar">
        <el-button size="small" type="primary" :loading="skillsUploading" @click="onUploadSkill">
          {{ t('assistant.skills.upload') }}
        </el-button>
        <span class="skills-hint">{{ t('assistant.skills.hint') }}</span>
      </div>
      <div v-if="skillsList.length" class="skills-list">
        <div v-for="s in skillsList" :key="s.dirName" class="skill-item">
          <div class="skill-info">
            <span class="skill-name">{{ s.name }}</span>
            <span class="skill-desc">{{ s.description }}</span>
          </div>
          <el-button size="small" text type="danger" @click="onDeleteSkill(s)">
            {{ t('actions.delete') }}
          </el-button>
        </div>
      </div>
      <el-empty v-else :description="t('assistant.skills.empty')" :image-size="60" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 可复用的对话核心组件（消息流 + 输入区 + SSE 流式逻辑 + HITL + 技能 + 附件）。
 * assistant/Index.vue（全页）与 AssistantQuick.vue（快捷弹层）共用。
 * - compact 模式：弹层内的紧凑版（隐藏工作目录 chip、缩小内边距）
 * - 会话由父级管理：sessionId 双向绑定，后端首次返回会话 id 时 emit('session')
 */
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, CaretRight, Plus, VideoPause, Document, Top, List, FolderOpened, MagicStick, WarningFilled, CircleCheckFilled, CircleCloseFilled, Clock, Cpu, CaretBottom, Check, Lock, Search, Reading, Collection } from '@element-plus/icons-vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useAuthStore } from '../stores/auth'
import { apiError } from '../api/http'
import { assistantApi, type ChatMsgDTO } from '../api/assistant'
import { memoriesApi } from '../api/memories'
import { knowledgeApi } from '../api/knowledge'

const props = withDefaults(defineProps<{
  /** 当前会话 id（父级持有；null = 新会话） */
  sessionId?: number | null
  /** 紧凑模式：弹层内隐藏工作目录等占位元素、收紧间距 */
  compact?: boolean
  /** 新建会话的来源渠道（quick_todo / quick_notes / app 默认），便于父级按渠道区分会话 */
  source?: string
}>(), { sessionId: null, compact: false, source: 'app' })

const emit = defineEmits<{
  /** 后端创建了新会话（父级记录，便于继续对话） */
  (e: 'session', id: number): void
  /** 会话列表可能变化（发送/停止后父级可刷新侧栏） */
  (e: 'sessions-changed'): void
}>()

const { t } = useI18n()
const auth = useAuthStore()

/**
 * AI 消息 markdown + KaTeX 渲染：
 * 1. 先提取 $$...$$ / \[...\]（块级）与 $...$ / \(...\)（行内）数学公式为占位符
 * 2. marked 渲染 markdown（占位符不经过 markdown 转义）
 * 3. 占位符回填 KaTeX HTML，最后 DOMPurify 净化输出
 */
marked.setOptions({ breaks: true, gfm: true })

const KATEX_HOLDER = '\u0000KX\u0000'

function extractMath(src: string): [string, string[]] {
  const store: string[] = []
  const text = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => holder(tex, true, store))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => holder(tex, true, store))
    .replace(/(^|[\s(（])\$([^$\n]+?)\$(?=$|[\s)）。,，;；!?！？])/g, (_, pre, tex) => pre + holder(tex, false, store))
    .replace(/\\\((.+?)\\\)/g, (_, tex) => holder(tex, false, store))
  return [text, store]
}

function holder(tex: string, display: boolean, store: string[]): string {
  let html: string
  try {
    html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false })
  } catch {
    html = `<code>${tex}</code>`
  }
  store.push(html)
  return `${KATEX_HOLDER}${store.length - 1}${KATEX_HOLDER}`
}

const PURIFY_CONFIG = {
  ADD_TAGS: ['math', 'maction', 'menclose', 'merror', 'mfrac', 'mi', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mprescripts', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover', 'semantics', 'annotation', 'svg', 'path', 'g', 'line', 'rect', 'use'],
  ADD_ATTR: ['xmlns', 'viewbox', 'preserveaspectratio', 'd', 'fill', 'stroke', 'stroke-width', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'aria-hidden', 'style', 'encoding']
}

function collapseBlanks(src: string): string {
  return String(src || '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim()
}

function renderMdCompact(src: string): string {
  const collapsed = String(src || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n([-*_]{3,}[ \t]*)\n/g, '\n\n$1\n\n')
    .trim()
  return renderMd(collapsed)
}

function renderMd(src: string): string {
  const normalized = String(src || '').replace(/\n{3,}/g, '\n\n')
  const [text, mathStore] = extractMath(normalized)
  let html = marked.parse(text) as string
  html = html.replace(new RegExp(`${KATEX_HOLDER}(\\d+)${KATEX_HOLDER}`, 'g'), (_, i) => mathStore[Number(i)] ?? '')
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}

const input = ref('')
const sending = ref(false)
const messages = ref<{ id: string; role: 'user' | 'assistant'; content: string; attachments?: { name: string; relPath: string; size: number }[]; timeline?: TlItem[]; thought?: string; tools?: any[]; usage?: { input: number; output: number }; finishedAt?: string; streaming?: boolean; hitl?: { tool: string; input?: any; prompt: string; decision?: 'approve' | 'reject' | 'ignore' }; memoryStatus?: 'running' | 'done' | 'skipped' | 'error'; memoryDetail?: string; knowledgeStatus?: 'running' | 'done' | 'skipped' | 'error'; knowledgeDetail?: string }[]>([])

/** AI 消息事件流时间线条目 */
interface TlItem {
  type: 'reasoning' | 'content' | 'tool'
  text?: string
  tool?: string
  input?: any
  output?: any
  running?: boolean
  runId?: string
}

/**
 * 消息分派：最后一个 content 段为最终总结，其余段为思考过程。
 * 无 timeline 的旧消息退化为 content=总结 / thought+tools=思考过程。
 */
function splitMsg(m: { content: string; timeline?: TlItem[]; thought?: string; tools?: any[] }): {
  thoughtTl: TlItem[]
  finalText: string
} {
  const tl = m.timeline
  if (!tl || !tl.length) {
    const thoughtTl: TlItem[] = []
    if (m.thought) thoughtTl.push({ type: 'reasoning', text: m.thought })
    for (const t of m.tools || []) thoughtTl.push({ type: 'tool', tool: t.tool, input: t.input, output: t.output })
    return { thoughtTl, finalText: m.content }
  }
  let lastContentIdx = -1
  for (let i = tl.length - 1; i >= 0; i--) {
    if (tl[i].type === 'content') { lastContentIdx = i; break }
  }
  const hasTrailingEvents = tl.slice(lastContentIdx + 1).some((x) => x.type !== 'content')
  const isFinal = lastContentIdx >= 0 && !hasTrailingEvents
  const thoughtTl = isFinal ? tl.slice(0, lastContentIdx) : tl
  return { thoughtTl, finalText: isFinal ? tl[lastContentIdx].text || '' : '' }
}

function tlPreview(m: { timeline?: TlItem[]; thought?: string }): string {
  const tl = m.timeline
  if (tl?.length) {
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tl[i].type === 'reasoning' || tl[i].type === 'content') return tl[i].text || ''
    }
    return ''
  }
  return m.thought || ''
}

function tlRunningTool(m: { timeline?: TlItem[]; tools?: any[] }): string {
  const tl = m.timeline
  if (tl?.length) {
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tl[i].type === 'tool' && tl[i].running && tl[i].tool !== 'write_todos') return tl[i].tool || ''
    }
    return ''
  }
  const t = (m.tools || []).find((x) => !x.output && x.tool !== 'write_todos')
  return t?.tool || ''
}

/** 消息的待办清单：write_todos 的 input.todos（兼容旧双层包装） */
function msgTodos(m: { timeline?: TlItem[] }): { content: string; status: string }[] | null {
  const tl = m.timeline
  if (!tl?.length) return null
  let latest: { content: string; status: string }[] | null = null
  for (const seg of tl) {
    if (seg.type === 'tool' && seg.tool === 'write_todos' && seg.input) {
      let args = seg.input
      if (args && typeof args === 'object' && 'input' in args && Object.keys(args).length <= 2) {
        const inner = (args as any).input
        if (typeof inner === 'string') {
          try { args = JSON.parse(inner) } catch { /* 保持原样 */ }
        } else if (inner && typeof inner === 'object') {
          args = inner
        }
      }
      const todos = (args as any)?.todos
      if (Array.isArray(todos) && todos.length) latest = todos
    }
  }
  return latest
}
const thoughtOpen = reactive<Record<string, boolean>>({})
const toolOpen = reactive<Record<string, boolean>>({})

function fmtJson(v: any): string {
  if (v == null) return ''
  let s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  if (s.length > 2000) s = s.slice(0, 2000) + '\n…'
  return s
}
const msgRef = ref<HTMLElement>()

/** 加载历史消息（父级切换会话后调用；quick 弹层打开时也用于恢复） */
async function loadHistory(id: number) {
  try {
    const s = await assistantApi.getSession(id)
    // 恢复该会话创建时的记忆开关（已有会话不可切换，仅作状态展示）
    memoryEnabled.value = s.memoryEnabled !== false
    // 恢复该会话使用的模型（未记录时保持默认选择，续聊后端会自动回填）
    if (s.modelId) selectedModelId.value = s.modelId
    else if (!selectedModelId.value) await loadChatModels()
    messages.value = (s.messages || []).map((m: ChatMsgDTO, i: number) => ({
      id: `h-${id}-${i}`,
      role: m.role,
      content: m.content,
      attachments: m.attachments,
      timeline: m.timeline,
      thought: m.thought,
      tools: m.tools,
      usage: m.usage,
      hitl: m.hitl ? { ...m.hitl, decision: m.hitl.decision || 'ignore' } : undefined,
      finishedAt: m.role === 'assistant' ? formatDateTime(new Date(m.at)) : undefined
    }))
    await scrollBottom()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

/** 清空为全新会话 */
function reset() {
  messages.value = []
  input.value = ''
  pendingHitl.value = null
  // 新会话记忆开关恢复默认开启（此时可再次修改）
  memoryEnabled.value = true
}

defineExpose({ loadHistory, reset, sending })

// ---- 工作目录（发送区右侧展示） ----
const workDir = ref<string | null>(null)

async function loadWorkDir() {
  try {
    const { notesApi } = await import('../api/notes')
    workDir.value = await notesApi.getWorkDir()
  } catch {
    workDir.value = null
  }
}

/** 在系统资源管理器中打开本会话的上传目录 */
async function openUploadDir() {
  if (!workDir.value) return
  const sid = props.sessionId ? String(props.sessionId) : 'draft'
  const rel = `app_work_space/${sid}/upload`
  try {
    await window.nodo.openInExplorer(rel)
  } catch (e: any) {
    if (/workdir not set/i.test(String(e?.message || ''))) {
      ElMessage.warning(t('assistant.needWorkDir'))
      return
    }
    try {
      await assistantApi.ensureUploadDir(props.sessionId)
      await window.nodo.openInExplorer(rel)
    } catch {
      ElMessage.warning(t('assistant.openUploadDir'))
    }
  }
}

async function onChangeWorkDir() {
  try {
    const dir = await window.nodo.selectWorkDir()
    if (!dir) return
    const { notesApi } = await import('../api/notes')
    await notesApi.setWorkDir(dir)
    workDir.value = dir
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

onMounted(loadWorkDir)
onMounted(loadChatModels)
const { onWorkDirChanged } = window.nodo
onMounted(() => onWorkDirChanged(loadWorkDir))

const hitlLoading = ref(false)
/** 待决策的 HITL 请求（输入区上方悬浮确认栏渲染；null = 无待确认） */
const pendingHitl = ref<{ msg: any; tool: string; input?: any; prompt: string } | null>(null)

function hitlDecisionText(d: string): string {
  if (d === 'approve') return t('assistant.hitlApproved')
  if (d === 'reject') return t('assistant.hitlRejected')
  return t('assistant.hitlIgnored')
}

/** HITL 确认栏：用户选择 → 后端 resolve 挂起的 onHitl → 智能体 resume 续跑 */
async function onHitlDecision(h: { msg: any }, decision: 'approve' | 'reject' | 'ignore') {
  if (hitlLoading.value || !props.sessionId) return
  hitlLoading.value = true
  const m = h.msg
  try {
    await assistantApi.confirm(props.sessionId, decision)
    if (m.hitl) m.hitl.decision = decision
    if (decision === 'ignore') {
      m.streaming = false
      sending.value = false
      m.finishedAt = formatDateTime(new Date())
    }
    pendingHitl.value = null
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    hitlLoading.value = false
  }
}

// ---- 技能管理 ----
const skillsDialog = ref(false)
const skillsList = ref<{ name: string; description: string; dirName: string; relPath: string }[]>([])
const skillsUploading = ref(false)

async function loadSkills() {
  try {
    skillsList.value = await assistantApi.listSkills()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

function openSkillsDialog() {
  if (!workDir.value) {
    ElMessage.warning(t('assistant.needWorkDir'))
    return
  }
  skillsDialog.value = true
  loadSkills()
}

async function onUploadSkill() {
  let picked: { name: string; base64: string; size: number }[] = []
  try {
    picked = await window.nodo.selectSkillFiles()
  } catch (e: any) {
    ElMessage.error(e?.message || t('assistant.skills.hint'))
    return
  }
  if (!picked.length) return
  skillsUploading.value = true
  try {
    for (const p of picked) {
      const bin = atob(p.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const file = new File([bytes], p.name)
      const skill = await assistantApi.uploadSkill(file)
      ElMessage.success(`${t('toast.skillInstalled')}: ${skill.name}`)
    }
    await loadSkills()
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    skillsUploading.value = false
  }
}

async function onDeleteSkill(s: { name: string; dirName: string }) {
  try {
    await ElMessageBox.confirm(
      t('assistant.skills.delConfirm', { name: s.name }),
      t('actions.delete'),
      { type: 'warning', confirmButtonText: t('actions.delete'), cancelButtonText: t('actions.cancel') }
    )
  } catch {
    return
  }
  try {
    await assistantApi.deleteSkill(s.dirName)
    await loadSkills()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// ---- 文件上传 ----
const attachments = ref<{ name: string; relPath: string; size: number }[]>([])
const uploading = ref(false)
const composerFocus = ref(false)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const webSearchEnabled = ref(true)
/** 记忆开关：新会话可改；已有会话由后端存的 memoryEnabled 决定且锁定 */
const memoryEnabled = ref(true)
/** 知识库开关：每轮可切换（挂载 knowledge_search / save_knowledge 工具），默认开启 */
const knowledgeEnabled = ref(true)

/** 加号下拉命令分发：upload / skills 打开功能，其余为开关切换（勾选状态） */
function onPlusCommand(cmd: string) {
  if (cmd === 'upload') { onPickFiles(); return }
  if (cmd === 'skills') { openSkillsDialog(); return }
  if (cmd === 'websearch') { webSearchEnabled.value = !webSearchEnabled.value; return }
  if (cmd === 'knowledge') { knowledgeEnabled.value = !knowledgeEnabled.value; return }
  if (cmd === 'memory' && !props.sessionId) { memoryEnabled.value = !memoryEnabled.value }
}

// ---- 模型选择（仅 chat 模型；记住最近选择，后端 lastChatModelId 持久化） ----
const chatModels = ref<{ id: string; name: string; provider?: string }[]>([])
const selectedModelId = ref('')
const currentModelName = computed(() => chatModels.value.find((m) => m.id === selectedModelId.value)?.name || t('assistant.pickModel'))

async function loadChatModels() {
  try {
    const res = await assistantApi.chatModels()
    chatModels.value = res.chatModels || []
    selectedModelId.value = res.selected || ''
  } catch { /* 未配置模型时静默 */ }
}

function onPickModel(id: string) {
  selectedModelId.value = id
  // 发送时随请求提交，后端写入 lastChatModelId 持久化（下次新对话默认使用）
}

// ---- 技能激活 ----
const skillPanelVisible = ref(false)
const skillSearch = ref('')
const skillSearchRef = ref<HTMLInputElement | null>(null)
const allSkills = ref<{ name: string; description: string; dirName: string; relPath: string }[]>([])
const selectedSkill = ref<{ name: string; description: string; dirName: string; relPath: string } | null>(null)

const filteredSkills = computed(() => {
  const kw = skillSearch.value.trim().toLowerCase()
  if (!kw) return allSkills.value
  return allSkills.value.filter(
    (s) => s.name.toLowerCase().includes(kw) || s.description.toLowerCase().includes(kw)
  )
})

async function openSkillPanel() {
  skillPanelVisible.value = true
  skillSearch.value = ''
  if (!allSkills.value.length) {
    try {
      allSkills.value = await assistantApi.listSkills()
    } catch (e) {
      ElMessage.error(apiError(e))
      skillPanelVisible.value = false
      return
    }
  }
  const ta = composerRef.value
  if (ta && ta.value.endsWith('/')) {
    const pos = ta.selectionStart ?? ta.value.length
    input.value = ta.value.slice(0, pos - 1) + ta.value.slice(pos)
    await nextTick(() => {
      ta.focus()
      ta.setSelectionRange(pos - 1, pos - 1)
    })
  }
  await nextTick()
  skillSearchRef.value?.focus()
}

function closeSkillPanel() {
  skillPanelVisible.value = false
  skillSearch.value = ''
}

function onDocMouseDown(e: MouseEvent) {
  if (!skillPanelVisible.value) return
  const panel = document.querySelector('.skill-panel')
  if (panel && !panel.contains(e.target as Node)) closeSkillPanel()
}
onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onUnmounted(() => document.removeEventListener('mousedown', onDocMouseDown))

function onSkillSearchEnter() {
  const first = filteredSkills.value[0]
  if (first) pickSkill(first)
}

function pickSkill(s: { name: string; description: string; dirName: string; relPath: string }) {
  selectedSkill.value = s
  closeSkillPanel()
  const ta = composerRef.value
  if (ta) nextTick(() => ta.focus())
}

function clearSelectedSkill() {
  selectedSkill.value = null
}

watch(input, (v, old) => {
  if (!skillPanelVisible.value) {
    if (v && v.length > (old?.length ?? 0) && v.endsWith('/')) {
      const prev = v.slice(0, -1)
      if (!prev || /[\s(（]$/.test(prev)) openSkillPanel()
    }
  }
})

function extOf(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toUpperCase() : 'FILE'
}
function fmtSize(bytes: number) {
  if (!bytes) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function onPickFiles() {
  let picked: { name: string; base64: string; size: number }[] = []
  try {
    picked = await window.nodo.selectUploadFiles()
  } catch {
    // 主进程异常时回退到 HTML 文件选择
  }
  if (!picked.length) return
  uploading.value = true
  for (const p of picked) {
    try {
      const bin = atob(p.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const file = new File([bytes], p.name)
      const r = await assistantApi.upload(file, props.sessionId)
      attachments.value.push(r)
    } catch (e) {
      const msg = apiError(e)
      if (/工作目录/.test(msg)) {
        try {
          await ElMessageBox.confirm(msg, t('assistant.needWorkDir'), {
            confirmButtonText: t('assistant.goNotes'),
            cancelButtonText: t('actions.cancel'),
            type: 'warning'
          })
          location.hash = '#/notes'
        } catch { /* 取消 */ }
      } else {
        ElMessage.error(msg)
      }
    }
  }
  uploading.value = false
}

function newId() { return `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }

function pushTl(m: any, type: 'reasoning' | 'content', text: string) {
  if (!m.timeline) m.timeline = []
  const last = m.timeline[m.timeline.length - 1]
  if (last && last.type === type) last.text = (last.text || '') + text
  else m.timeline.push({ type, text })
}

function pushTlTool(m: any, tool: string, input: any, runId?: string) {
  if (!m.timeline) m.timeline = []
  m.timeline.push({ type: 'tool', tool, input, running: true, runId })
}

function fmtNum(n: number): string {
  return Number(n || 0).toLocaleString()
}

function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 记忆更新状态轮询句柄（runId → 定时器；SSE 关闭后兜底获取终态） */
const memoryPollers = new Map<string, ReturnType<typeof setInterval>>()

/** 知识沉淀状态轮询句柄（runId → 定时器；SSE 关闭后兜底获取终态） */
const knowledgePollers = new Map<string, ReturnType<typeof setInterval>>()

/** 状态超时句柄（防进程重启导致终态事件丢失，前端永远停在「沉淀中」） */
const statusTimers = new Map<'memory' | 'knowledge', ReturnType<typeof setTimeout>>()

/** 启动状态超时兜底：3 分钟无终态则标记失败（后端重启/进程死亡时终态事件会丢失） */
function armStatusTimeout(kind: 'memory' | 'knowledge', msg: { memoryStatus?: string; memoryDetail?: string; knowledgeStatus?: string; knowledgeDetail?: string }) {
  clearStatusTimeout(kind)
  const timer = setTimeout(() => {
    // 只在仍为 running 时触发（正常路径终态已先到）
    const status = kind === 'memory' ? msg.memoryStatus : msg.knowledgeStatus
    if (status === 'running') {
      if (kind === 'memory') {
        msg.memoryStatus = 'error'
        msg.memoryDetail = '更新超时（服务可能已重启），请稍后在记忆管理中查看'
      } else {
        msg.knowledgeStatus = 'error'
        msg.knowledgeDetail = '沉淀超时（服务可能已重启），请稍后在知识库中查看'
      }
    }
    statusTimers.delete(kind)
  }, 3 * 60 * 1000)
  statusTimers.set(kind, timer)
}

function clearStatusTimeout(kind: 'memory' | 'knowledge') {
  const timer = statusTimers.get(kind)
  if (timer) {
    clearTimeout(timer)
    statusTimers.delete(kind)
  }
}

/** 应用记忆流水线进度：running 时启动日志轮询兜底，终态停轮询 */
function applyMemoryUpdate(msg: { memoryStatus?: 'running' | 'done' | 'skipped' | 'error'; memoryDetail?: string }, data: any) {
  msg.memoryStatus = data.status
  if (data.detail) msg.memoryDetail = data.detail
  if (data.status === 'running') armStatusTimeout('memory', msg)
  else clearStatusTimeout('memory')
  const runId: string = data.runId || ''
  if (!runId) return
  if (data.status === 'running') {
    // SSE 可能在流水线结束前关闭：轮询 /memories/logs 直到该 runId 出现终态
    if (memoryPollers.has(runId)) return
    const timer = setInterval(async () => {
      try {
        const logs = await memoriesApi.logs()
        const mine = logs.filter((l) => l.runId === runId)
        const final = [...mine].reverse().find((l) => l.step === 'done' || l.step === 'error')
        if (!final) return
        // 终态：done → 统计增删改；error → 失败原因
        if (final.step === 'done') {
          msg.memoryStatus = 'done'
          msg.memoryDetail = final.message.startsWith('结束：')
            ? final.message.slice(3)
            : final.message.includes('新增 0、更新 0、删除 0') ? '记忆无变化' : final.message.replace(/^完成：/, '')
        } else {
          msg.memoryStatus = 'error'
          msg.memoryDetail = final.message
        }
        clearInterval(timer!)
        memoryPollers.delete(runId)
      } catch { /* 轮询失败静默重试 */ }
    }, 3000)
    memoryPollers.set(runId, timer)
  } else {
    const timer = memoryPollers.get(runId)
    if (timer) {
      clearInterval(timer)
      memoryPollers.delete(runId)
    }
  }
}

/** 应用知识抽取进度：running 时启动日志轮询兜底，终态停轮询 */
function applyKnowledgeUpdate(msg: { knowledgeStatus?: 'running' | 'done' | 'skipped' | 'error'; knowledgeDetail?: string }, data: any) {
  msg.knowledgeStatus = data.status
  if (data.detail) msg.knowledgeDetail = data.detail
  if (data.status === 'running') armStatusTimeout('knowledge', msg)
  else clearStatusTimeout('knowledge')
  const runId: string = data.runId || ''
  if (!runId) return
  if (data.status === 'running') {
    // SSE 可能在流水线结束前关闭：轮询 /knowledge/logs 直到该 runId 出现终态
    if (knowledgePollers.has(runId)) return
    const timer = setInterval(async () => {
      try {
        const logs = await knowledgeApi.logs()
        const mine = logs.filter((l) => l.runId === runId)
        const final = [...mine].reverse().find((l) => l.step === 'done' || l.step === 'error')
        if (!final) return
        if (final.step === 'done') {
          msg.knowledgeStatus = 'done'
          msg.knowledgeDetail = final.message.startsWith('结束：')
            ? final.message.slice(3)
            : final.message.includes('新增 0、更新 0、删除 0') ? '知识无变化' : final.message.replace(/^完成：/, '')
        } else {
          msg.knowledgeStatus = 'error'
          msg.knowledgeDetail = final.message
        }
        clearInterval(timer!)
        knowledgePollers.delete(runId)
      } catch { /* 轮询失败静默重试 */ }
    }, 3000)
    knowledgePollers.set(runId, timer)
  } else {
    const timer = knowledgePollers.get(runId)
    if (timer) {
      clearInterval(timer)
      knowledgePollers.delete(runId)
    }
  }
}

onUnmounted(() => {
  for (const timer of memoryPollers.values()) clearInterval(timer)
  memoryPollers.clear()
  for (const timer of knowledgePollers.values()) clearInterval(timer)
  knowledgePollers.clear()
  for (const timer of statusTimers.values()) clearTimeout(timer)
  statusTimers.clear()
})

async function onSend() {
  const text = input.value.trim()
  if ((!text && !attachments.value.length) || sending.value) return
  if (!auth.token) {
    ElMessage.warning(t('auth.login'))
    return
  }
  const atts = attachments.value.splice(0)
  const skills = selectedSkill.value ? [selectedSkill.value.dirName] : []
  selectedSkill.value = null
  closeSkillPanel()
  messages.value.push({ id: newId(), role: 'user', content: text, attachments: atts.length ? atts : undefined })
  input.value = ''
  sending.value = true

  const assistantMsg = ref<{ id: string; role: 'assistant'; content: string; timeline: TlItem[]; usage?: { input: number; output: number }; finishedAt?: string; streaming: boolean; hitl?: { tool: string; input?: any; prompt: string; decision?: 'approve' | 'reject' | 'ignore' }; memoryStatus?: 'running' | 'done' | 'skipped' | 'error'; memoryDetail?: string; knowledgeStatus?: 'running' | 'done' | 'skipped' | 'error'; knowledgeDetail?: string }>({
    id: newId(), role: 'assistant', content: '', timeline: [], streaming: true
  })
  messages.value.push(assistantMsg.value as any)

  await scrollBottom()

  try {
    const port = await window.nodo.getServerPort()
    const resp = await fetch(`http://127.0.0.1:${port}/assistant/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify({ message: text, attachments: atts, activeSkills: skills, webSearchEnabled: webSearchEnabled.value, memoryEnabled: memoryEnabled.value, knowledgeEnabled: knowledgeEnabled.value, modelId: selectedModelId.value || undefined, sessionId: props.sessionId || undefined, source: props.source })
    })
    if (!resp.ok || !resp.body) throw new Error(t('assistant.requestFailed'))
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const evt of events) {
        const lines = evt.split('\n')
        let eventName = 'message'
        let dataStr = ''
        for (const l of lines) {
          if (l.startsWith('event:')) eventName = l.slice(6).trim()
          else if (l.startsWith('data:')) dataStr += l.slice(5).trim()
        }
        if (!dataStr) continue
        let data: any
        try { data = JSON.parse(dataStr) } catch { continue }
        if (eventName === 'session') {
          if (data.id) emit('session', data.id)
        } else if (eventName === 'token') {
          pushTl(assistantMsg.value, 'content', data.v)
          await scrollBottom()
        } else if (eventName === 'thought') {
          pushTl(assistantMsg.value, 'reasoning', data.v)
          await scrollBottom()
        } else if (eventName === 'tool') {
          if (data.input) {
            pushTlTool(assistantMsg.value, data.tool, data.input, data.runId)
          } else if (data.output !== undefined) {
            const tl = assistantMsg.value.timeline || []
            const rec = data.runId
              ? tl.find((x) => x.type === 'tool' && x.runId === data.runId)
              : [...tl].reverse().find((x) => x.type === 'tool' && x.tool === data.tool && x.running)
            if (rec) {
              rec.output = data.output
              rec.running = false
            }
          }
          await scrollBottom()
        } else if (eventName === 'hitl') {
          assistantMsg.value.hitl = { tool: data.tool, input: data.input, prompt: data.prompt }
          pendingHitl.value = { msg: assistantMsg.value, tool: data.tool, input: data.input, prompt: data.prompt }
          await scrollBottom()
        } else if (eventName === 'hitl_timeout') {
          pendingHitl.value = null
          if (assistantMsg.value.hitl && !assistantMsg.value.hitl.decision) {
            assistantMsg.value.hitl.decision = 'ignore'
            ElMessage.warning(t('assistant.hitlTimeout'))
          }
        } else if (eventName === 'done') {
          if (data.usage) assistantMsg.value.usage = data.usage
        } else if (eventName === 'memory_update') {
          // 记忆流水线进度：回答后异步更新记忆（running = 正在更新，done/error = 结束）
          // SSE 流可能在流水线结束前关闭，终态由日志轮询兜底
          applyMemoryUpdate(assistantMsg.value, data)
        } else if (eventName === 'knowledge_update') {
          // 知识抽取进度：回答后异步沉淀事实性知识到知识库（独立任务）
          // SSE 流可能在流水线结束前关闭，终态由日志轮询兜底
          applyKnowledgeUpdate(assistantMsg.value, data)
        } else if (eventName === 'error') {
          ElMessage.error(data.message || t('assistant.needConfig'))
        }
      }
    }
  } catch (e) {
    ElMessage.error(apiError(e, t('assistant.needConfig')))
  } finally {
    assistantMsg.value.streaming = false
    sending.value = false
    assistantMsg.value.finishedAt = formatDateTime(new Date())
    thoughtOpen[assistantMsg.value.id] = false
    pendingHitl.value = null
    await scrollBottom()
    emit('sessions-changed')
  }
}

async function onStop() {
  if (props.sessionId != null) {
    try {
      await assistantApi.stop(props.sessionId)
    } catch {
      // 停止失败不影响本地状态复位
    }
  }
  sending.value = false
  const last = messages.value[messages.value.length - 1]
  if (last?.streaming) last.streaming = false
  if (pendingHitl.value) {
    if (pendingHitl.value.msg.hitl && !pendingHitl.value.msg.hitl.decision) {
      pendingHitl.value.msg.hitl.decision = 'ignore'
    }
    pendingHitl.value = null
  }
  await scrollBottom()
  emit('sessions-changed')
}

async function scrollBottom() {
  await nextTick()
  if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
}
</script>

<!-- 全局样式：下拉菜单 popper 挂载在 body 下，scoped 样式无法命中 -->
<style>
.plus-dropdown-menu .el-dropdown-menu__item { display: flex; align-items: center; gap: 8px; min-width: 170px; }
.plus-dropdown-menu .el-dropdown-menu__item.is-on { color: var(--el-color-primary); font-weight: 600; }
.plus-dropdown-menu .el-dropdown-menu__item.is-disabled { opacity: 0.45; }
.plus-dropdown-menu .plus-dropdown-divider {
  height: 1px; margin: 4px 8px;
  background: var(--el-border-color-lighter);
}
</style>

<style scoped>
.chat-core { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.messages {
  flex: 1; overflow: auto; padding: 20px 24px;
  display: flex; flex-direction: column; gap: 14px;
}
/* 紧凑模式（弹层）：收紧内边距 */
.chat-core.compact .messages { padding: 14px 14px; gap: 10px; }
.chat-core.compact .composer { padding: 10px 12px 12px; }
.msg { display: flex; }
/* 用户消息：右对齐圆角气泡 */
.msg.user { justify-content: flex-end; }
.msg.user .bubble {
  max-width: 70%; border-radius: 12px;
  background: var(--el-color-primary); color: #fff;
}
/* AI 消息：通栏占满，浅底卡片 */
.msg.assistant .bubble {
  max-width: none; min-width: 40%;
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
}
.bubble {
  padding: 10px 14px;
  line-height: 1.6; word-break: break-word; white-space: pre-wrap;
}
/* AI 消息 markdown 排版 */
.md { white-space: normal; }
.md :deep(p) { margin: 0 0 8px; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { margin: 12px 0 6px; line-height: 1.4; }
.md :deep(h1) { font-size: 1.3em; } .md :deep(h2) { font-size: 1.2em; } .md :deep(h3) { font-size: 1.1em; }
.md :deep(ul), .md :deep(ol) { margin: 4px 0 8px; padding-left: 1.4em; }
.md :deep(li) { margin: 2px 0; }
.md :deep(code) {
  background: var(--el-fill-color-darker); padding: 1px 5px; border-radius: 4px;
  font-size: 0.9em; font-family: Consolas, 'Courier New', monospace;
}
.md :deep(pre) {
  margin: 8px 0; padding: 10px 12px; border-radius: 8px; overflow: auto;
  background: var(--el-fill-color-darker); max-height: 420px;
}
.md :deep(pre code) { background: transparent; padding: 0; font-size: 12px; line-height: 1.6; }
.md :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: 0.95em; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--el-border-color-lighter); padding: 5px 10px; }
.md :deep(th) { background: var(--el-fill-color-light); }
.md :deep(blockquote) {
  margin: 8px 0; padding: 4px 12px; color: var(--el-text-color-secondary);
  border-left: 3px solid var(--el-border-color); background: var(--el-fill-color-lighter); border-radius: 0 6px 6px 0;
}
.md :deep(a) { color: var(--el-color-primary); }
.md :deep(hr) { border: none; border-top: 1px solid var(--el-border-color-lighter); margin: 10px 0; }
/* KaTeX 公式 */
.md :deep(.katex) { font-size: 1.05em; }
.md :deep(.katex-display) { margin: 10px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
.bubble .tools { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.tool-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-blank); overflow: hidden; cursor: pointer; }
.tool-card:hover { border-color: var(--el-border-color); }
.tool-head {
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: none; background: transparent; cursor: pointer;
  color: var(--el-text-color-regular); font-size: 12px;
}
.tool-head:hover { background: var(--el-fill-color-light); }
.tool-head.clickable { padding: 5px 10px; }
.tool-name { font-weight: 500; }
.tool-status { margin-left: auto; font-size: 11px; }
.tool-status.running { color: var(--el-color-warning); }
.tool-status.ok { color: var(--el-color-success); }
.tool-sec { padding: 6px 10px; }
.tool-sec + .tool-sec { border-top: 1px dashed var(--el-border-color-lighter); }
.tool-sec-label { font-size: 11px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.tool-body { border-top: 1px dashed var(--el-border-color-lighter); }
.tool-body pre {
  margin: 0; padding: 8px; border-radius: 6px; max-height: 240px; overflow: auto;
  background: var(--el-fill-color-darker); color: var(--el-text-color-regular);
  font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;
}
.tool-caret { font-size: 12px; color: var(--el-text-color-secondary); transition: transform 0.2s; flex-shrink: 0; }
.tool-caret.rot { transform: rotate(90deg); }
.thought { margin-bottom: 8px; border-radius: 8px; background: var(--el-fill-color-light); overflow: hidden; }
.thought-head {
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: none; background: transparent; cursor: pointer;
  color: var(--el-text-color-secondary); font-size: 12px;
}
.thought-head:hover { color: var(--el-text-color-primary); }
.thought-icon { font-size: 12px; flex-shrink: 0; }
.thought .thought-icon { transition: transform 0.2s; }
.thought.open .thought-icon { transform: rotate(90deg); }
.thought .thought-icon.is-loading { animation: rotating 1.2s linear infinite; }
.thought-label { flex-shrink: 0; }
.thought-preview {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: var(--el-text-color-placeholder); text-align: left;
}
.thought-tool {
  flex-shrink: 0; font-size: 11px; color: var(--el-color-warning); margin-left: auto;
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.thought-body {
  padding: 4px 12px 10px; color: var(--el-text-color-secondary); font-size: 12px;
  line-height: 1.6; word-break: break-word;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.tl-seg { margin: 2px 0; }
.tl-seg:first-child { margin-top: 2px; }
.tl-reasoning { white-space: pre-wrap; }
.tl-content { color: var(--el-text-color-regular); }
.thought-body :deep(p),
.thought-body :deep(h1),
.thought-body :deep(h2),
.thought-body :deep(h3),
.thought-body :deep(h4),
.thought-body :deep(h5),
.thought-body :deep(h6),
.thought-body :deep(ul),
.thought-body :deep(ol),
.thought-body :deep(li),
.thought-body :deep(blockquote),
.thought-body :deep(pre),
.thought-body :deep(hr) { margin: 0; }
.thought-body :deep(h1),
.thought-body :deep(h2),
.thought-body :deep(h3),
.thought-body :deep(h4),
.thought-body :deep(h5),
.thought-body :deep(h6) { font-size: 1em; font-weight: 600; display: inline-block; }
.thought-body :deep(ul),
.thought-body :deep(ol) { padding-left: 18px; }
.thought-body :deep(hr) { border: none; border-top: 1px solid var(--el-border-color-lighter); }
.tl-tool .tool-card { background: var(--el-fill-color-blank); }
/* HITL 悬浮确认栏 */
.hitl-bar { padding: 0 24px 10px; }
.chat-core.compact .hitl-bar { padding: 0 12px 8px; }
.hitl-bar-inner {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 12px;
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-bg-color-overlay);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.hitl-bar-icon { color: var(--el-color-warning); font-size: 20px; flex-shrink: 0; }
.hitl-bar-text { flex: 1; min-width: 0; }
.hitl-bar-title { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.hitl-bar-desc {
  font-size: 12px; color: var(--el-text-color-regular); margin-top: 2px; line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hitl-bar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.hitl-btn {
  padding: 6px 16px; border-radius: 999px; border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank); color: var(--el-text-color-regular);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 0.15s ease;
}
.hitl-btn:hover { border-color: var(--el-text-color-secondary); color: var(--el-text-color-primary); }
.hitl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hitl-btn.primary {
  border-color: var(--el-color-primary); background: var(--el-color-primary); color: #fff;
}
.hitl-btn.primary:hover { background: var(--el-color-primary-light-3); border-color: var(--el-color-primary-light-3); }
.hitl-btn.danger {
  border-color: var(--el-color-danger); background: transparent; color: var(--el-color-danger);
}
.hitl-btn.danger:hover { background: var(--el-color-danger); color: #fff; }
.hitl-pop-enter-active, .hitl-pop-leave-active { transition: all 0.22s ease; }
.hitl-pop-enter-from, .hitl-pop-leave-to { opacity: 0; transform: translateY(8px); }
/* HITL 决策记录 */
.hitl-record {
  display: flex; align-items: center; gap: 6px; margin-top: 8px;
  font-size: 11px; line-height: 1.4;
}
.hitl-record-icon { flex-shrink: 0; font-size: 13px; }
.hitl-record.approve .hitl-record-icon { color: var(--el-color-success); }
.hitl-record.reject .hitl-record-icon { color: var(--el-color-danger); }
.hitl-record.ignore .hitl-record-icon { color: var(--el-text-color-placeholder); }
.hitl-record-badge { flex-shrink: 0; font-weight: 600; color: var(--el-text-color-secondary); }
.hitl-record.approve .hitl-record-badge { color: var(--el-color-success); }
.hitl-record.reject .hitl-record-badge { color: var(--el-color-danger); }
.hitl-record.ignore .hitl-record-badge { color: var(--el-text-color-placeholder); }
.hitl-record-prompt {
  flex: 1; min-width: 0; color: var(--el-text-color-placeholder);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* AI 气泡底部元信息 */
.msg-meta {
  display: flex; align-items: center; gap: 12px; margin-top: 8px;
  font-size: 11px; color: var(--el-text-color-placeholder);
  border-top: 1px dashed var(--el-border-color-lighter); padding-top: 6px;
}
.msg-meta span { white-space: nowrap; }
/* 记忆更新状态徽标 */
.mem-status { display: inline-flex; align-items: center; gap: 4px; }
.mem-status.running { color: var(--el-color-primary); }
.mem-status.done { color: var(--el-color-success); }
.mem-status.error { color: var(--el-color-danger); }
.rotating { animation: mem-rotate 1s linear infinite; }
@keyframes mem-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
/* 待办清单 */
.todo-list {
  margin-top: 8px; padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-light);
}
.todo-list-title { font-size: 12px; font-weight: 500; color: var(--el-text-color-primary); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
.todo-count { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--el-text-color-secondary); }
.todo-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; color: var(--el-text-color-regular); }
.todo-item .todo-check {
  width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
  border: 1.5px solid var(--el-border-color); display: inline-flex;
  align-items: center; justify-content: center; transition: all 0.2s;
}
.todo-item.done .todo-check, .todo-item.completed .todo-check { background: var(--el-color-success); border-color: var(--el-color-success); }
.todo-item.done .todo-check::after, .todo-item.completed .todo-check::after { content: '✓'; color: #fff; font-size: 10px; line-height: 1; }
.todo-item.done .todo-text, .todo-item.completed .todo-text { color: var(--el-text-color-placeholder); text-decoration: line-through; }
.todo-item.pending .todo-check, .todo-item.in_progress .todo-check { border-color: var(--el-color-warning); }
.todo-item.pending .todo-check::after, .todo-item.in_progress .todo-check::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-warning); }
.todo-item.in_progress .todo-text { color: var(--el-color-primary); }
@keyframes rotating { from { transform: rotate(0) } to { transform: rotate(360deg) } }
.composer {
  padding: 12px 24px 16px; border-top: 1px solid var(--el-border-color);
}
/* 一体化卡片输入框 */
.composer-card {
  position: relative;
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 12px 8px; border-radius: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.composer-card.focused {
  border-color: var(--el-border-color);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.composer-input {
  resize: none; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 15px; line-height: 1.6; color: var(--el-text-color-primary);
  padding: 2px 4px; width: 100%; max-height: 160px; overflow-y: auto;
}
.composer-input::placeholder { color: var(--el-text-color-placeholder); }
.composer-input:disabled { opacity: 0.6; }
.composer-actions { display: flex; align-items: center; gap: 6px; }
.composer-spacer { flex: 1; }
.icon-btn {
  width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
  background: transparent; color: var(--el-text-color-regular);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background-color 0.2s, color 0.2s; flex-shrink: 0;
}
.icon-btn:hover:not(:disabled) { background: var(--el-fill-color); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn .el-icon { font-size: 20px; }
/* 加号下拉菜单：功能行（图标+文字+末尾勾选） */
.plus-menu-label { flex: 1; }
.plus-menu-check {
  margin-left: auto; width: 16px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--el-color-primary);
}
.plus-menu-check .el-icon { font-size: 14px; font-weight: 700; }
.model-pick {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 8px; margin-left: 2px;
  border: none; border-radius: 13px; cursor: pointer;
  background: var(--el-fill-color-light); color: var(--el-text-color-secondary);
  font-size: 12px; transition: background-color 0.2s;
}
.model-pick:hover { background: var(--el-fill-color); color: var(--el-text-color-primary); }
.model-pick.locked { cursor: default; opacity: 0.75; }
.model-pick.locked:hover { background: var(--el-fill-color-light); color: var(--el-text-color-secondary); }
.model-pick-name {
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1;
}
.model-menu-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
:deep(.el-dropdown-menu__item.active) { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.model-menu-check { margin-left: 6px; }
.workdir-chip {
  display: inline-flex; align-items: center;
  max-width: 320px; height: 26px; padding: 0 6px 0 0;
  border-radius: 13px; overflow: hidden;
  background: var(--el-fill-color-light); color: var(--el-text-color-secondary);
  transition: background-color 0.2s;
}
.workdir-chip:hover { background: var(--el-fill-color); }
.workdir-main {
  display: inline-flex; align-items: center; gap: 4px;
  height: 100%; padding: 0 4px 0 10px;
  border: none; background: transparent; cursor: pointer;
  color: inherit; font-size: 12px; line-height: 1; white-space: nowrap;
}
.workdir-path {
  display: inline-flex; align-items: center; min-width: 0; flex: 1;
  height: 100%; padding: 0 4px;
  border: none; background: transparent; cursor: pointer;
  color: var(--el-color-primary); font-size: 12px; line-height: 1;
  transition: color 0.2s;
}
.workdir-path:hover { color: var(--el-color-primary-dark-2); }
.workdir-name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  direction: rtl; unicode-bidi: isolate; text-align: left; line-height: 1;
}
/* 技能管理弹窗 */
.skills-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding-bottom: 10px; margin-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.skills-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.skills-list { display: flex; flex-direction: column; }
.skill-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 2px; border-bottom: 1px solid var(--el-border-color-extra-light);
}
.skill-item:last-child { border-bottom: none; }
.skill-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.skill-name { font-weight: 600; font-size: 13px; color: var(--el-text-color-primary); }
.skill-desc {
  font-size: 12px; color: var(--el-text-color-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 技能激活面板 */
.skill-panel {
  position: absolute; left: 10px; right: 10px; bottom: calc(100% + 6px);
  z-index: 30; max-height: 280px;
  display: flex; flex-direction: column;
  background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color-light);
  border-radius: 10px; overflow: hidden;
  box-shadow: var(--el-box-shadow-light);
}
.skill-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px 6px;
}
.skill-panel-title { font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); }
.skill-panel-search { padding: 0 12px 8px; }
.skill-search-input {
  width: 100%; height: 28px; padding: 0 10px;
  border: 1px solid var(--el-border-color); border-radius: 6px;
  background: var(--el-fill-color-blank); color: var(--el-text-color-primary);
  font-size: 13px; outline: none;
}
.skill-search-input:focus { border-color: var(--el-color-primary); }
.skill-panel-list {
  flex: 1; overflow-y: auto; padding: 0 6px 6px;
}
.skill-option {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%; padding: 7px 10px;
  border: none; border-radius: 6px; background: transparent; cursor: pointer;
  text-align: left;
}
.skill-option:hover { background: var(--el-fill-color-light); }
.skill-option-name { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.skill-option-desc {
  font-size: 12px; color: var(--el-text-color-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.skill-panel-empty {
  padding: 16px 0; text-align: center;
  font-size: 12px; color: var(--el-text-color-secondary);
}
/* 已激活技能 chip */
.active-skill-row { padding: 2px 2px 0; }
.active-skill-chip {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 100%; height: 28px; padding: 0 8px;
  border-radius: 8px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  color: var(--el-color-primary);
}
.active-skill-chip .el-icon { flex-shrink: 0; }
.active-skill-name { font-size: 12px; font-weight: 700; white-space: nowrap; }
.active-skill-desc {
  font-size: 12px; color: var(--el-text-color-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 320px;
}
.active-skill-del {
  width: 16px; height: 16px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; background: transparent; cursor: pointer;
  color: var(--el-color-primary); font-size: 13px; line-height: 1;
  transition: background-color 0.2s;
}
.active-skill-del:hover { background: var(--el-color-primary-light-8); }
.send-btn {
  width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer;
  background: var(--el-text-color-primary); color: var(--el-bg-color);
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: auto; flex-shrink: 0;
  transition: opacity 0.2s, background-color 0.2s;
}
.send-btn:hover:not(:disabled) { opacity: 0.82; }
.send-btn:disabled { background: var(--el-fill-color); color: var(--el-text-color-placeholder); cursor: not-allowed; }
.send-btn.stop { background: var(--el-color-danger); color: #fff; }
.send-btn.stop:hover { opacity: 0.85; }
.send-btn .el-icon { font-size: 17px; }
/* 附件文件卡 */
.att-list { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 4px 4px; }
.att-chip {
  position: relative; display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 10px; max-width: 260px;
  background: var(--el-fill-color-light);
}
.att-thumb {
  width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
  background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter);
  display: flex; align-items: center; justify-content: center;
  color: var(--el-text-color-regular);
}
.att-thumb .el-icon { font-size: 19px; }
.att-meta { min-width: 0; padding-right: 14px; }
.att-name { font-size: 13px; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-sub { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.att-del {
  position: absolute; top: 5px; right: 5px; width: 18px; height: 18px; padding: 0;
  border: none; border-radius: 50%; cursor: pointer; line-height: 1;
  background: var(--el-fill-color-dark); color: var(--el-text-color-secondary);
  opacity: 0; transition: opacity 0.15s, color 0.15s; font-size: 13px;
}
.att-chip:hover .att-del { opacity: 1; }
.att-del:hover { color: var(--el-color-danger); }
.msg-atts { padding: 0; margin-top: 8px; }
.msg.user .att-chip {
  background: rgba(255, 255, 255, 0.16);
  max-width: 100%;
}
.msg.user .att-thumb {
  background: rgba(255, 255, 255, 0.22);
  border-color: transparent;
  color: #fff;
}
.msg.user .att-name { color: #fff; }
.msg.user .att-sub { color: rgba(255, 255, 255, 0.75); }
.empty { color: var(--el-text-color-secondary); text-align: center; margin: auto; }
.typing .dot { animation: blink 1s infinite; }
@keyframes blink { 0%,100% { opacity: 0 } 50% { opacity: 1 } }
</style>
