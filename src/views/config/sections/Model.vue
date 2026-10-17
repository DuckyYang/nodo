<template>
  <div class="models-section">
    <!-- 工具栏 -->
    <div class="models-toolbar">
      <el-button type="primary" size="small" :icon="Plus" @click="openEdit(null)">{{ t('config.models.add') }}</el-button>
      <span class="models-hint">{{ t('config.models.hint') }}</span>
    </div>

    <!-- 模型卡片列表 -->
    <div class="models-list" v-loading="loading">
      <div v-for="m in models" :key="m.id" class="model-card">
        <div class="model-card-head">
          <span class="model-type" :class="m.type">{{ typeLabel(m.type) }}</span>
          <span class="model-name" :title="m.name">{{ m.name }}</span>
          <span v-if="m.provider" class="model-provider">{{ m.provider }}</span>
          <span class="model-ops">
            <el-button size="small" text type="primary" :icon="Edit" @click="openEdit(m)">{{ t('actions.edit') }}</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="onDelete(m)">{{ t('actions.delete') }}</el-button>
          </span>
        </div>
        <div class="model-card-meta">
          <span class="model-baseurl" :title="m.baseUrl">{{ m.baseUrl }}</span>
          <span v-if="m.type === 'chat' && m.thinking" class="model-tag">{{ t('config.thinking') }}</span>
          <span v-if="m.type === 'chat' && typeof m.temperature === 'number'" class="model-tag">T {{ m.temperature }}</span>
          <span v-if="m.type === 'embedding' && m.dimensions" class="model-tag">{{ m.dimensions }}d</span>
        </div>
      </div>
      <el-empty v-if="!loading && !models.length" :description="t('config.models.empty')" :image-size="70" />
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? t('config.models.edit') : t('config.models.add')" width="520px" append-to-body @closed="resetForm">
      <el-form :model="form" label-position="top">
        <el-form-item :label="t('config.models.type')">
          <el-select v-model="form.type" :disabled="!!editingId">
            <el-option v-for="tp in modelTypes" :key="tp" :label="typeLabel(tp)" :value="tp" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('config.modelName')">
          <el-input v-model="form.name" :placeholder="form.type === 'embedding' ? t('config.embNamePh') : t('config.modelNamePh')" />
        </el-form-item>
        <el-form-item :label="t('config.baseUrl')">
          <el-input v-model="form.baseUrl" :placeholder="t('config.baseUrlPh')" />
        </el-form-item>
        <el-form-item :label="t('config.apiKey')">
          <el-input v-model="form.apiKey" type="password" show-password :placeholder="maskHint" />
          <p class="tip">{{ t('config.maskHint') }}</p>
        </el-form-item>
        <template v-if="form.type === 'chat'">
          <el-form-item :label="t('config.provider')">
            <el-select v-model="form.provider">
              <el-option label="OpenAI" value="openai" />
              <el-option label="DeepSeek" value="deepseek" />
              <el-option :label="t('config.providerQwen')" value="qwen" />
              <el-option :label="t('config.providerZhipu')" value="zhipu" />
              <el-option label="Anthropic Claude" value="anthropic" />
              <el-option :label="t('config.providerCustom')" value="custom" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('config.temperature')">
            <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" />
          </el-form-item>
          <el-form-item :label="t('config.thinking')">
            <el-switch v-model="form.thinking" />
            <p class="tip">{{ t('config.thinkingTip') }}</p>
          </el-form-item>
          <el-form-item :label="t('config.extraBody')">
            <el-input v-model="form.extraBody" type="textarea" :rows="2" :placeholder="t('config.extraBodyPh')" />
            <p class="tip">{{ t('config.extraBodyTip') }}</p>
          </el-form-item>
        </template>
        <el-form-item v-if="form.type === 'embedding'" :label="t('config.embDims')">
          <el-input-number v-model="form.dimensions" :min="64" :max="4096" :step="128" />
          <p class="tip">{{ t('config.embDimsTip') }}</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :loading="testing" @click="onTest">{{ t('config.pgTest') }}</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">{{ t('actions.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete } from '@element-plus/icons-vue'
import { configApi, type ModelItemDTO, type ModelType } from '../../../api/config'
import { useConfigStore } from '../../../stores/config'
import { apiError } from '../../../api/http'

/**
 * 模型列表管理（合并旧「模型配置」与「向量模型」）：
 * - 每个模型带用途类型 chat/embedding/rerank/ocr/tts/asr
 * - 旧 modelConfig/embeddingConfig 在后端读取时自动迁移为列表项
 */
const { t } = useI18n()
const cfgStore = useConfigStore()

const modelTypes: ModelType[] = ['chat', 'embedding', 'rerank', 'ocr', 'tts', 'asr']
const typeLabels: Record<ModelType, string> = {
  chat: 'chat',
  embedding: 'embedding',
  rerank: 'rerank',
  ocr: 'OCR',
  tts: 'TTS',
  asr: 'ASR'
}

const models = ref<ModelItemDTO[]>([])
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const maskHint = ref('')

const form = ref<any>({
  type: 'chat' as ModelType,
  name: '',
  baseUrl: '',
  apiKey: '',
  provider: 'custom',
  temperature: 0.3,
  thinking: false,
  extraBody: '',
  dimensions: 1024
})

function typeLabel(tp: ModelType): string {
  return t(`config.models.type_${tp}`) || typeLabels[tp]
}

async function load() {
  loading.value = true
  try {
    const cfg = await configApi.get()
    models.value = cfg.modelItems || []
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    loading.value = false
  }
}

function openEdit(m: ModelItemDTO | null) {
  if (m) {
    editingId.value = m.id
    form.value = {
      type: m.type,
      name: m.name,
      baseUrl: m.baseUrl || '',
      apiKey: '',
      provider: m.provider || 'custom',
      temperature: typeof m.temperature === 'number' ? m.temperature : 0.3,
      thinking: m.thinking === true,
      extraBody: m.extraBody || '',
      dimensions: m.dimensions || 1024
    }
    maskHint.value = m.apiKey ? `${t('config.currentKey')}${m.apiKey}` : ''
  } else {
    editingId.value = null
    maskHint.value = ''
  }
  dialogVisible.value = true
}

function resetForm() {
  form.value = { type: 'chat', name: '', baseUrl: '', apiKey: '', provider: 'custom', temperature: 0.3, thinking: false, extraBody: '', dimensions: 1024 }
  editingId.value = null
  maskHint.value = ''
}

/** 测试连通（embedding 返回维度自动回填） */
async function onTest() {
  testing.value = true
  try {
    const payload: any = { ...form.value, id: editingId.value || undefined }
    if (!payload.apiKey) delete payload.apiKey
    const res = await configApi.testModel(payload)
    if (res?.dimensions) {
      form.value.dimensions = res.dimensions
      ElMessage.success(`${t('config.pgTestOk')}（${res.dimensions} 维）`)
    } else {
      ElMessage.success(t('config.pgTestOk'))
    }
  } catch (e) {
    ElMessage.error(`${t('config.pgTestFail')}：${apiError(e)}`)
  } finally {
    testing.value = false
  }
}

async function onSave() {
  if (!String(form.value.name || '').trim()) {
    ElMessage.warning(t('config.models.nameRequired'))
    return
  }
  saving.value = true
  try {
    const payload: any = { ...form.value, id: editingId.value || undefined }
    if (!payload.apiKey) delete payload.apiKey
    await configApi.upsertModel(payload)
    dialogVisible.value = false
    await load()
    await cfgStore.reload()
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    saving.value = false
  }
}

async function onDelete(m: ModelItemDTO) {
  try {
    await ElMessageBox.confirm(t('config.models.delConfirm', { name: m.name }), t('actions.delete'), {
      type: 'warning',
      confirmButtonText: t('actions.delete'),
      cancelButtonText: t('actions.cancel')
    })
  } catch {
    return
  }
  try {
    await configApi.removeModel(m.id)
    await load()
    await cfgStore.reload()
    ElMessage.success(t('toast.deleted'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

onMounted(load)
</script>

<style scoped>
.models-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.models-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.models-list { display: flex; flex-direction: column; gap: 10px; min-height: 120px; }
.model-card {
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px;
  padding: 12px 16px; background: var(--el-bg-color);
  transition: border-color 0.15s;
}
.model-card:hover { border-color: var(--el-color-primary-light-5); }
.model-card-head { display: flex; align-items: center; gap: 10px; }
.model-type {
  font-size: 11px; padding: 2px 10px; border-radius: 10px; flex-shrink: 0;
  background: var(--el-color-primary-light-9); color: var(--el-color-primary);
}
.model-type.embedding { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.model-type.rerank { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.model-type.ocr { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.model-type.tts { background: var(--el-color-info-light-9); color: var(--el-color-info); }
.model-type.asr { background: #f0e6ff; color: #8e44ad; }
.model-name { font-size: 14px; font-weight: 500; color: var(--el-text-color-primary); word-break: break-all; }
.model-provider { font-size: 11px; color: var(--el-text-color-placeholder); flex-shrink: 0; }
.model-ops { margin-left: auto; display: inline-flex; flex-shrink: 0; }
.model-card-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.model-baseurl {
  font-size: 12px; color: var(--el-text-color-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;
}
.model-tag {
  font-size: 11px; padding: 1px 8px; border-radius: 8px; flex-shrink: 0;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin: 4px 0 0; }
</style>
