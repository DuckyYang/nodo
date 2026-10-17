<template>
  <div class="nodo-page memories-page">
    <!-- 头部：标题 + 总数 + 检索 -->
    <div class="mem-head">
      <span class="mem-title">{{ t('memory.title') }}</span>
      <span class="mem-total">{{ list.length }}<template v-if="keyword"> / {{ totalCount }}</template></span>
      <div class="mem-search">
        <el-input
          v-model="keyword"
          clearable
          :placeholder="t('memory.searchPh')"
          :prefix-icon="Search"
          style="width: 260px"
          @input="onSearch"
        />
      </div>
    </div>

    <!-- 模型配置：记忆生成使用的 chat 模型（保存后每次生成都用它） -->
    <div v-if="chatModels.length" class="mem-model-row">
      <span class="mem-model-label">{{ t('memory.modelLabel') }}</span>
      <el-select v-model="selectedModelId" size="small" style="width: 240px" :disabled="modelSaving" @change="onModelChange">
        <el-option v-for="m in chatModels" :key="m.id" :label="m.name" :value="m.id" />
      </el-select>
      <span class="mem-model-tip">{{ t('memory.modelTip') }}</span>
    </div>

    <!-- 未配置提示 -->
    <el-alert
      v-if="notReady"
      :title="t('memory.notReady')"
      :description="t('memory.notReadyTip')"
      type="info"
      show-icon
      :closable="false"
      class="mem-alert"
    />

    <!-- 列表 -->
    <div class="mem-list" v-loading="loading">
      <div v-for="m in list" :key="m.id" class="mem-item">
        <div class="mem-item-main">
          <div class="mem-item-head">
            <span class="mem-cat" :class="m.category">{{ categoryLabel(m.category) }}</span>
            <span class="mem-conf" :title="t('memory.confidenceTip', { n: fmtConfidence(m) })">
              <el-icon :size="12"><CircleCheck /></el-icon>{{ fmtConfidence(m) }}
            </span>
          </div>
          <div v-if="editingId === m.id" class="mem-edit">
            <el-input v-model="editContent" type="textarea" :rows="3" />
            <div class="mem-edit-actions">
              <el-button size="small" type="primary" :loading="saving" @click="saveEdit(m)">{{ t('actions.save') }}</el-button>
              <el-button size="small" @click="cancelEdit">{{ t('actions.cancel') }}</el-button>
            </div>
          </div>
          <div v-else class="mem-content">{{ m.content }}</div>
          <div class="mem-item-foot">
            <span class="mem-meta">
              <span v-if="m.sourceSession" class="mem-src">{{ t('memory.fromSession') }} #{{ m.sourceSession }}</span>
              <span class="mem-time">{{ fmtTime(m.updatedAt) }}</span>
            </span>
            <span class="mem-ops">
              <el-button size="small" text type="primary" :icon="Edit" @click="startEdit(m)">{{ t('actions.edit') }}</el-button>
              <el-button size="small" text type="danger" :icon="Delete" @click="onDelete(m)">{{ t('actions.delete') }}</el-button>
            </span>
          </div>
        </div>
      </div>
      <el-empty v-if="!loading && !list.length" :description="keyword ? t('memory.noMatch') : t('memory.empty')" :image-size="80" />
    </div>

    <!-- 流水线日志抽屉 -->
    <el-drawer v-model="logsVisible" :title="t('memory.logsTitle')" size="42%" append-to-body>
      <div class="mem-logs-toolbar">
        <span class="mem-logs-hint">{{ t('memory.logsHint') }}</span>
        <el-button size="small" text type="danger" @click="onClearLogs">{{ t('memory.logsClear') }}</el-button>
      </div>
      <div class="mem-logs" ref="logsRef">
        <template v-for="(g, gi) in logGroups" :key="g.runId">
          <div class="mem-log-run">
            <span class="mem-log-time">{{ fmtTime(g.entries[0].at) }}</span>
            <span class="mem-log-sid">#{{ g.sessionId }}</span>
          </div>
          <div v-for="(e, ei) in g.entries" :key="gi + '-' + ei" class="mem-log-line" :class="e.step">
            <span class="mem-log-step">{{ stepLabel(e.step) }}</span>
            <span class="mem-log-msg">{{ e.message }}</span>
          </div>
        </template>
        <el-empty v-if="!logGroups.length" :description="t('memory.logsEmpty')" :image-size="70" />
      </div>
    </el-drawer>
    <button v-if="logsVisible" class="mem-logs-close" type="button" @click="logsVisible = false">×</button>
    <el-button
      class="mem-logs-btn"
      type="primary"
      plain
      size="small"
      :icon="Document"
      @click="logsVisible = true"
    >{{ t('memory.logsTitle') }}</el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Edit, Delete, CircleCheck, Document } from '@element-plus/icons-vue'
import { memoriesApi, type MemoryDTO, type MemoryLogDTO } from '../../api/memories'
import { apiError } from '../../api/http'

defineOptions({ name: 'MemoriesIndex' })

/**
 * 记忆管理独立页面（头像下拉菜单进入）：
 * - 单一用户记忆（小助理对用户的了解，按用户隔离）
 * - 记忆生成模型配置（chat 模型，保存后每次生成都使用）
 * - 关键词检索（300ms 防抖）、行内编辑（重新向量化）、删除
 * - 流水线进度日志（轮询 3s，抽屉展示）
 */
const { t } = useI18n()

const list = ref<MemoryDTO[]>([])
/** 记忆总数（搜索时显示「匹配数 / 总数」） */
const totalCount = ref(0)
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
/** 记忆库未配置（pg / 向量模型缺失） */
const notReady = ref(false)

const editingId = ref<number | null>(null)
const editContent = ref('')

// ---- 记忆生成模型 ----
const chatModels = ref<{ id: string; name: string }[]>([])
const selectedModelId = ref('')
const modelSaving = ref(false)

// ---- 流水线日志 ----
const logsVisible = ref(false)
const logs = ref<MemoryLogDTO[]>([])
const logsRef = ref<HTMLElement>()
let logTimer: ReturnType<typeof setInterval> | null = null

/** 日志按 runId 分组（一次对话一轮） */
const logGroups = computed(() => {
  const groups: { runId: string; sessionId: number; entries: MemoryLogDTO[] }[] = []
  for (const e of logs.value) {
    const last = groups[groups.length - 1]
    if (last && last.runId === e.runId) last.entries.push(e)
    else groups.push({ runId: e.runId, sessionId: e.sessionId, entries: [e] })
  }
  return groups
})

let searchTimer: ReturnType<typeof setTimeout> | null = null

function fmtConfidence(m: MemoryDTO): string {
  const c = m.confidence ?? 0.8
  return `${Math.round(c * 100)}%`
}

function categoryLabel(c?: string | null): string {
  const key = ['fact', 'behavior', 'preference', 'experience'].includes(String(c)) ? String(c) : 'fact'
  return t(`memory.cat_${key}`)
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function stepLabel(step: string): string {
  const key = `memory.logStep_${step}`
  const label = t(key)
  return label === key ? step : label
}

async function load() {
  loading.value = true
  try {
    list.value = await memoriesApi.list('user', keyword.value)
    notReady.value = false
    // 总数（不带关键词）
    if (keyword.value) {
      memoriesApi.list('user').then((all) => (totalCount.value = all.length)).catch(() => {})
    } else {
      totalCount.value = list.value.length
    }
  } catch (e: any) {
    // 未配置 pg / 向量模型：展示引导提示而非报错
    if (e?.response?.data?.code === 'MEMORY_NOT_READY' || String(e?.message || '').includes('记忆')) {
      notReady.value = true
      list.value = []
      totalCount.value = 0
    } else {
      ElMessage.error(apiError(e))
    }
  } finally {
    loading.value = false
  }
}

/** 记忆生成模型配置 */
async function loadModel() {
  try {
    const res = await memoriesApi.getModel()
    chatModels.value = res.chatModels || []
    selectedModelId.value = res.selected || ''
  } catch { /* 静默 */ }
}

async function onModelChange(id: string) {
  modelSaving.value = true
  try {
    await memoriesApi.setModel(id)
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    modelSaving.value = false
  }
}

// ---- 流水线日志轮询 ----
async function pollLogs() {
  try {
    logs.value = await memoriesApi.logs()
    if (logsVisible.value) {
      await nextTick()
      logsRef.value?.scrollTo({ top: logsRef.value.scrollHeight })
    }
  } catch { /* 静默 */ }
}

async function onClearLogs() {
  try {
    logs.value = await memoriesApi.logs(true)
  } catch { /* 静默 */ }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}

function startEdit(m: MemoryDTO) {
  editingId.value = m.id
  editContent.value = m.content
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
}

async function saveEdit(m: MemoryDTO) {
  const content = editContent.value.trim()
  if (!content) {
    ElMessage.warning(t('memory.contentRequired'))
    return
  }
  saving.value = true
  try {
    const updated = await memoriesApi.update('user', m.id, { content })
    const idx = list.value.findIndex((x) => x.id === m.id)
    if (idx >= 0) list.value[idx] = updated
    cancelEdit()
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    saving.value = false
  }
}

async function onDelete(m: MemoryDTO) {
  try {
    await ElMessageBox.confirm(t('memory.delConfirm'), t('actions.delete'), {
      type: 'warning',
      confirmButtonText: t('actions.delete'),
      cancelButtonText: t('actions.cancel')
    })
  } catch {
    return
  }
  try {
    await memoriesApi.remove('user', m.id)
    list.value = list.value.filter((x) => x.id !== m.id)
    totalCount.value--
    ElMessage.success(t('toast.deleted'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

onMounted(() => {
  load()
  loadModel()
  pollLogs()
  logTimer = setInterval(pollLogs, 3000)
})

/** keep-alive 切回：刷新列表与模型选择（保留搜索词/抽屉等 UI 状态） */
onActivated(() => {
  load()
  loadModel()
})

onUnmounted(() => {
  if (logTimer) clearInterval(logTimer)
})
</script>

<style scoped>
.memories-page { display: flex; flex-direction: column; padding: 20px 24px; overflow: hidden; position: relative; }

.mem-head { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; flex-shrink: 0; }
.mem-title { font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.mem-total {
  font-size: 11px; padding: 1px 8px; border-radius: 8px;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.mem-search { margin-left: auto; }
.mem-alert { margin-bottom: 12px; flex-shrink: 0; }

.mem-model-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin-bottom: 12px; flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px;
  background: var(--el-fill-color-light);
}
.mem-model-label { font-size: 13px; font-weight: 500; color: var(--el-text-color-primary); flex-shrink: 0; }
.mem-model-tip { font-size: 12px; color: var(--el-text-color-secondary); }

.mem-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 4px 16px; }
.mem-item {
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px;
  background: var(--el-bg-color);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.mem-item:hover { border-color: var(--el-color-primary-light-5); box-shadow: 0 1px 6px rgba(0,0,0,0.04); }
.mem-item-main { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.mem-item-head { display: flex; align-items: center; gap: 10px; }
.mem-cat {
  font-size: 11px; padding: 2px 10px; border-radius: 10px;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.mem-cat.fact { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.mem-cat.behavior { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.mem-cat.preference { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.mem-cat.experience { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.mem-conf {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; color: var(--el-text-color-placeholder);
}
.mem-content {
  font-size: 13px; line-height: 1.7; color: var(--el-text-color-regular);
  white-space: pre-wrap; word-break: break-word;
}
.mem-item-foot { display: flex; align-items: center; justify-content: space-between; }
.mem-meta { display: inline-flex; align-items: center; gap: 10px; }
.mem-src { font-size: 11px; color: var(--el-text-color-placeholder); }
.mem-time { font-size: 11px; color: var(--el-text-color-placeholder); }
.mem-edit { display: flex; flex-direction: column; gap: 8px; }
.mem-edit-actions { display: flex; justify-content: flex-end; gap: 4px; }

.mem-logs-btn { position: absolute; right: 24px; bottom: 24px; z-index: 5; }
.mem-logs-close {
  position: fixed; top: 16px; right: 20px; z-index: 2001;
  width: 28px; height: 28px; border: none; border-radius: 50%;
  background: transparent; color: var(--el-text-color-secondary);
  font-size: 18px; cursor: pointer;
}
.mem-logs-close:hover { color: var(--el-text-color-primary); background: var(--el-fill-color); }
.mem-logs-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.mem-logs-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.mem-logs {
  display: flex; flex-direction: column; gap: 4px;
  max-height: calc(100vh - 140px); overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px;
}
.mem-log-run {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 0 4px; padding-bottom: 4px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}
.mem-log-run:first-child { margin-top: 0; }
.mem-log-time { color: var(--el-text-color-placeholder); font-size: 11px; }
.mem-log-sid { color: var(--el-color-primary); font-size: 11px; }
.mem-log-line { display: flex; gap: 8px; align-items: baseline; }
.mem-log-step {
  flex-shrink: 0; min-width: 52px; text-align: center;
  padding: 0 6px; border-radius: 8px; font-size: 10px;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.mem-log-line.error .mem-log-step { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.mem-log-line.done .mem-log-step { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.mem-log-line.extract .mem-log-step,
.mem-log-line.synthesize .mem-log-step { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.mem-log-line.search .mem-log-step { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.mem-log-msg { color: var(--el-text-color-regular); word-break: break-all; line-height: 1.6; }
</style>
