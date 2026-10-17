<template>
  <div class="nodo-page knowledge-page">
    <!-- 未配置引导 -->
    <div v-if="notReady" class="not-ready">
      <el-alert type="warning" :closable="false" show-icon>
        <template #title>{{ t('knowledge.notReady') }}</template>
        <div class="nr-tip">
          {{ t('knowledge.notReadyTip') }}
          <el-button type="primary" link @click="router.push('/config/postgresql')">{{ t('knowledge.goConfig') }}</el-button>
        </div>
      </el-alert>
    </div>

    <template v-else>
      <!-- 头部：标题 + 总数 + 检索 + 上传 -->
      <div class="kb-head">
        <span class="kb-title">{{ t('knowledge.title') }}</span>
        <span class="kb-total">{{ list.length }}</span>
        <div class="kb-search">
          <el-input
            v-model="keyword"
            clearable
            :placeholder="t('knowledge.searchPh')"
            :prefix-icon="Search"
            style="width: 240px"
            @input="onSearch"
          />
        </div>
        <el-upload
          :show-file-list="false"
          :before-upload="onUpload"
          accept=".docx,.xlsx,.pdf,.md,.txt"
          :disabled="uploading"
        >
          <el-button type="primary" :loading="uploading" :icon="Upload">{{ t('knowledge.upload') }}</el-button>
        </el-upload>
      </div>

      <div v-if="uploadHint" class="kb-upload-hint">{{ uploadHint }}</div>

      <!-- 切片模型配置：生成切片使用的 chat 模型（保存后每次切片都用它） -->
      <div v-if="chatModels.length" class="kb-model-row">
        <span class="kb-model-label">{{ t('knowledge.modelLabel') }}</span>
        <el-select v-model="selectedModelId" size="small" style="width: 240px" :disabled="modelSaving" @change="onModelChange">
          <el-option v-for="m in chatModels" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <span class="kb-model-tip">{{ t('knowledge.modelTip') }}</span>
      </div>

      <!-- 列表 -->
      <div v-loading="loading" class="kb-list">
        <el-empty v-if="!list.length && !loading" :description="keyword ? t('knowledge.noMatch') : t('knowledge.empty')" />
        <div v-for="d in list" :key="d.id" class="kb-card" @click="openDetail(d.id)">
          <div class="kb-card-top">
            <el-icon :size="16" class="kb-icon" :class="d.source"><Document v-if="d.source === 'file'" /><ChatDotRound v-else /></el-icon>
            <span class="kb-name" :title="d.fileName || d.title">{{ d.title }}</span>
            <el-tag size="small" :type="d.source === 'file' ? 'primary' : 'success'" effect="plain" class="kb-src">
              {{ d.source === 'file' ? t('knowledge.srcFile') : t('knowledge.srcChat') }}
            </el-tag>
            <span class="kb-meta">
              {{ fmtSize(d.size) }} · {{ d.charCount.toLocaleString() }} {{ t('knowledge.chars') }}
            </span>
            <div class="kb-actions" @click.stop>
              <el-button
                v-if="d.status === 'error'"
                size="small" type="primary" plain :icon="RefreshRight"
                @click="onRetry(d)"
              >{{ t('knowledge.retry') }}</el-button>
              <el-button size="small" type="danger" plain :icon="Delete" @click="onDelete(d)">{{ t('actions.delete') }}</el-button>
            </div>
          </div>
          <!-- 状态行：进行中显示进度（处理中列表轮询自动刷新）；完成显示切片数；失败显示原因 -->
          <div class="kb-card-status">
            <template v-if="isBusy(d.status)">
              <el-icon :size="12" class="rotating"><Loading /></el-icon>
              <span class="busy">{{ statusText(d) }}</span>
            </template>
            <template v-else-if="d.status === 'done'">
              <el-icon :size="12" class="ok"><CircleCheckFilled /></el-icon>
              <span class="ok-text">{{ t('knowledge.chunks', { n: d.chunkCount }) }}</span>
              <span v-if="d.md5" class="md5" :title="d.md5">md5: {{ d.md5.slice(0, 10) }}…</span>
            </template>
            <template v-else-if="d.status === 'error'">
              <el-icon :size="12" class="err"><CircleCloseFilled /></el-icon>
              <span class="err-text" :title="d.statusDetail || ''">{{ d.statusDetail || t('knowledge.fail') }}</span>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- 切片查看抽屉 -->
    <el-drawer v-model="drawer" size="620px" :title="detail?.doc.title || t('knowledge.title')" class="kb-drawer">
      <div v-if="detail" class="kb-detail">
        <div class="kb-detail-meta">
          <div><span class="k">{{ t('knowledge.srcLabel') }}</span>{{ detail.doc.source === 'file' ? t('knowledge.srcFile') : t('knowledge.srcChat') }}</div>
          <div><span class="k">{{ t('knowledge.chunkCount') }}</span>{{ detail.chunks.length }}</div>
          <div v-if="detail.doc.fileName"><span class="k">{{ t('knowledge.fileLabel') }}</span>{{ detail.doc.fileName }}</div>
          <div v-if="detail.doc.sourceSession"><span class="k">{{ t('knowledge.fromSession') }}</span>#{{ detail.doc.sourceSession }}</div>
        </div>
        <el-empty v-if="!detail.chunks.length" :description="t('knowledge.noChunks')" />
        <div v-for="c in detail.chunks" :key="c.id" class="kb-chunk">
          <div class="kb-chunk-head">
            <el-tag size="small" effect="plain">#{{ c.seq + 1 }}</el-tag>
            <span class="kb-chunk-len">{{ c.charCount }} {{ t('knowledge.chars') }}</span>
          </div>
          <pre class="kb-chunk-body">{{ c.content }}</pre>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Upload, Delete, RefreshRight, Document, ChatDotRound, Loading, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { knowledgeApi, type KnowledgeDocDTO } from '../../api/knowledge'
import { apiError } from '../../api/http'

defineOptions({ name: 'KnowledgeIndex' })

/**
 * 知识库管理独立页面（头像下拉菜单进入）：
 * - 两种来源：用户上传文件（docx/xlsx/pdf/md/txt，5M 内，md5 去重）+ 小助理对话沉淀
 * - 处理流水线：解析 → 模型语义切片 → 向量化入库；状态实时轮询展示
 * - 点击卡片查看全部切片
 */
const { t } = useI18n()
const router = useRouter()

const list = ref<KnowledgeDocDTO[]>([])
const keyword = ref('')
const loading = ref(false)
const uploading = ref(false)
const uploadHint = ref('')
/** 知识库未配置（pg / 向量模型缺失） */
const notReady = ref(false)
const drawer = ref(false)

// ---- 切片生成模型 ----
const chatModels = ref<{ id: string; name: string; provider?: string; baseUrl?: string }[]>([])
const selectedModelId = ref('')
const modelSaving = ref(false)
const detail = ref<{ doc: KnowledgeDocDTO; chunks: { id: number; seq: number; content: string; charCount: number }[] } | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

/** 是否有处理中的条目（有则开轮询刷进度） */
function hasBusy() {
  return list.value.some((d) => ['pending', 'parsing', 'chunking', 'embedding'].includes(String(d.status)))
}

function isBusy(status: string) {
  return ['pending', 'parsing', 'chunking', 'embedding'].includes(String(status))
}

function statusText(d: KnowledgeDocDTO): string {
  if (d.statusDetail) return d.statusDetail
  switch (d.status) {
    case 'pending': return t('knowledge.stPending')
    case 'parsing': return t('knowledge.stParsing')
    case 'chunking': return t('knowledge.stChunking')
    case 'embedding': return t('knowledge.stEmbedding')
    default: return d.status
  }
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    list.value = await knowledgeApi.list(keyword.value)
    notReady.value = false
  } catch (e: any) {
    if (e?.response?.data?.code === 'KNOWLEDGE_NOT_READY' || String(e?.message || '').includes('知识')) {
      notReady.value = true
      list.value = []
    } else if (!silent) {
      ElMessage.error(apiError(e))
    }
  } finally {
    if (!silent) loading.value = false
  }
  // 有进行中的条目 → 3s 轮询；全部结束停轮询
  if (hasBusy()) startPolling()
  else stopPolling()
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => load(true), 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(), 300)
}

/** 上传：先建记录，页面轮询显示进度 */
async function onUpload(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!['docx', 'xlsx', 'pdf', 'md', 'txt'].includes(ext)) {
    ElMessage.error(t('knowledge.unsupported', { ext }))
    return false
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error(t('knowledge.tooLarge'))
    return false
  }
  uploading.value = true
  uploadHint.value = t('knowledge.uploading', { name: file.name })
  try {
    const r = await knowledgeApi.upload(file)
    if (r.duplicate) {
      ElMessage.warning(t('knowledge.duplicate', { title: r.doc.title }))
    } else {
      ElMessage.success(t('knowledge.uploaded'))
    }
    await load()
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    uploading.value = false
    uploadHint.value = ''
  }
  return false // 阻止 el-upload 默认上传行为
}

/** 切片模型配置：读取（当前选中 + chat 模型列表） */
async function loadModel() {
  try {
    const r = await knowledgeApi.getModel()
    chatModels.value = r.chatModels || []
    selectedModelId.value = r.selected || ''
  } catch { /* 静默 */ }
}

/** 切片模型配置：保存后每次切片（文件上传 / 对话沉淀）都使用该模型 */
async function onModelChange(id: string) {
  modelSaving.value = true
  try {
    await knowledgeApi.setModel(id)
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    modelSaving.value = false
  }
}

async function onRetry(d: KnowledgeDocDTO) {
  try {
    await knowledgeApi.retry(d.id)
    ElMessage.success(t('knowledge.retrying'))
    await load()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function onDelete(d: KnowledgeDocDTO) {
  try {
    await ElMessageBox.confirm(t('knowledge.delConfirm', { title: d.title, n: d.chunkCount }), t('actions.delete'), {
      type: 'warning',
      confirmButtonText: t('actions.delete'),
      cancelButtonText: t('actions.cancel')
    })
  } catch {
    return
  }
  try {
    await knowledgeApi.remove(d.id)
    list.value = list.value.filter((x) => x.id !== d.id)
    ElMessage.success(t('toast.deleted'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function openDetail(id: number) {
  try {
    detail.value = await knowledgeApi.detail(id)
    drawer.value = true
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

function fmtSize(size?: number | null): string {
  if (size == null) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

onMounted(() => {
  load()
  loadModel()
})

/** keep-alive 切回：刷新列表与模型选择（保留搜索词/抽屉等 UI 状态） */
onActivated(() => {
  load()
  loadModel()
})
onUnmounted(stopPolling)
</script>

<style scoped>
.knowledge-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  box-sizing: border-box;
  overflow: hidden;
}
.not-ready { max-width: 640px; }
.nr-tip { margin-top: 6px; font-size: 13px; color: var(--el-text-color-secondary); }

.kb-head { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; flex-shrink: 0; }
.kb-title { font-size: 16px; font-weight: 600; color: var(--el-text-color-primary); }
.kb-total {
  font-size: 11px; padding: 1px 8px; border-radius: 8px;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.kb-search { margin-left: auto; }
.kb-upload-hint {
  font-size: 12px; color: var(--el-color-primary); padding-bottom: 8px; flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
}

.kb-model-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin-bottom: 12px; flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px;
  background: var(--el-fill-color-light);
}
.kb-model-label { font-size: 13px; font-weight: 500; color: var(--el-text-color-primary); flex-shrink: 0; }
.kb-model-tip { font-size: 12px; color: var(--el-text-color-secondary); }

.kb-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.kb-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 12px 16px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  background: var(--el-bg-color);
}
.kb-card:hover { border-color: var(--el-color-primary-light-5); background: var(--el-fill-color-extra-light); }
.kb-card-top { display: flex; align-items: center; gap: 8px; }
.kb-icon { color: var(--el-text-color-secondary); flex-shrink: 0; }
.kb-icon.file { color: var(--el-color-primary); }
.kb-icon.chat { color: var(--el-color-success); }
.kb-name {
  font-size: 14px; font-weight: 500; color: var(--el-text-color-primary);
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kb-src { flex-shrink: 0; }
.kb-meta { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
.kb-actions { margin-left: auto; display: flex; gap: 8px; }

.kb-card-status { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; }
.kb-card-status .busy { color: var(--el-color-primary); }
.kb-card-status .ok { color: var(--el-color-success); }
.kb-card-status .ok-text { color: var(--el-color-success); }
.kb-card-status .err { color: var(--el-color-danger); }
.kb-card-status .err-text {
  color: var(--el-color-danger);
  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kb-card-status .md5 { color: var(--el-text-color-placeholder); }
.rotating { animation: kb-rotate 1s linear infinite; }
@keyframes kb-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.kb-detail-meta {
  display: flex; flex-wrap: wrap; gap: 16px; padding-bottom: 12px; margin-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px; color: var(--el-text-color-regular);
}
.kb-detail-meta .k { color: var(--el-text-color-secondary); margin-right: 4px; }
.kb-chunk { margin-bottom: 12px; }
.kb-chunk-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.kb-chunk-len { font-size: 12px; color: var(--el-text-color-secondary); }
.kb-chunk-body {
  margin: 0; padding: 10px 12px; border-radius: 8px;
  background: var(--el-fill-color-light);
  font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-all;
  max-height: 260px; overflow-y: auto;
  font-family: inherit;
  color: var(--el-text-color-regular);
}
</style>
