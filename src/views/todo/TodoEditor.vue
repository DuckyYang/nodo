<template>
  <el-drawer v-model="visible" :title="todo ? t('actions.edit') : t('todo.addTodo')" size="420px" append-to-body>
    <el-form :model="form" label-position="top" @submit.prevent>
      <el-form-item :label="t('todo.content')" required>
        <el-input v-model="form.content" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item :label="t('todo.remark')">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
      <!-- 步骤（子任务）：仅编辑已有待办时可用（新建保存后再添加） -->
      <el-form-item v-if="todo" :label="t('todo.steps')">
        <div class="steps-box">
          <draggable
            v-model="steps"
            item-key="id"
            :animation="200"
            handle=".step-drag"
            @end="onStepsDragEnd"
          >
            <template #item="{ element }">
              <div class="step-item">
                <el-icon class="step-drag" :size="12"><Rank /></el-icon>
                <el-checkbox
                  :model-value="!!element.done"
                  size="small"
                  @change="onToggleStep(element)"
                />
                <input
                  class="step-input"
                  :class="{ done: element.done }"
                  :value="element.content"
                  @change="onStepContent(element, $event)"
                />
                <button class="step-del" type="button" @click="onDeleteStep(element)">
                  <el-icon :size="14"><Close /></el-icon>
                </button>
              </div>
            </template>
          </draggable>
          <div class="step-add">
            <el-input
              v-if="addingStep"
              ref="stepInputRef"
              v-model="newStep"
              size="small"
              :placeholder="t('todo.addStep')"
              @keyup.enter="onAddStep"
              @keyup.escape="cancelAddStep"
              @blur="onAddStepBlur"
            >
              <template #prefix><el-icon :size="12"><Plus /></el-icon></template>
            </el-input>
            <el-button v-else link type="primary" :icon="Plus" @click="startAddStep">
              {{ t('todo.addStep') }}
            </el-button>
          </div>
        </div>
      </el-form-item>
      <el-form-item :label="t('todo.group')">
        <el-select v-model="form.groupId" clearable>
          <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('todo.status')">
        <el-radio-group v-model="form.status">
          <el-radio-button value="not_started">{{ t('todo.statusNotStarted') }}</el-radio-button>
          <el-radio-button value="in_progress">{{ t('todo.statusInProgress') }}</el-radio-button>
          <el-radio-button value="completed">{{ t('todo.statusCompleted') }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('todo.owner')">
        <el-select v-model="form.owner" filterable clearable :placeholder="t('todo.ownerPlaceholder')">
          <el-option-group v-for="g in groupedUserOptions" :key="g.label" :label="g.label">
            <el-option v-for="u in g.users" :key="u.id" :label="u.name || u.email" :value="u.name || u.email" />
          </el-option-group>
        </el-select>
      </el-form-item>
      <el-form-item :label="t('todo.collaborators')">
        <el-select v-model="form.collaborators" multiple filterable :placeholder="t('todo.collaboratorsPlaceholder')">
          <el-option-group v-for="g in groupedUserOptions" :key="g.label" :label="g.label">
            <el-option v-for="u in g.users" :key="u.id" :label="u.name || u.email" :value="u.name || u.email" />
          </el-option-group>
        </el-select>
      </el-form-item>
      <el-form-item :label="t('todo.planStart')">
        <el-date-picker v-model="form.planStart" type="datetime" format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DDTHH:mm:ss" />
      </el-form-item>
      <el-form-item :label="t('todo.planEnd')">
        <el-date-picker v-model="form.planEnd" type="datetime" format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DDTHH:mm:ss" />
      </el-form-item>
      <el-form-item :label="t('todo.remind')">
        <el-switch v-model="form.remindEnabled" />
      </el-form-item>
      <template v-if="form.remindEnabled">
        <!-- 开始提醒：计划开始前 x 分钟（x ≥ 3，依赖计划开始时间） -->
        <el-form-item :label="t('todo.remindStart')">
          <div class="remind-row">
            <el-tooltip :content="t('todo.remindNeedPlanStart')" :disabled="!!form.planStart" placement="top">
              <span class="remind-switch-wrap">
                <el-switch v-model="form.remindRule.startEnabled" :disabled="!form.planStart" />
              </span>
            </el-tooltip>
            <template v-if="form.remindRule.startEnabled">
              <el-input-number v-model="form.remindRule.startBeforeMinutes" :min="3" :step="1" step-strictly />
              <span class="remind-unit">{{ t('todo.minutesBeforeStart') }}</span>
            </template>
          </div>
        </el-form-item>
        <!-- 结束提醒：计划完成前 x 分钟（x ≥ 3，依赖计划完成时间） -->
        <el-form-item :label="t('todo.remindEnd')">
          <div class="remind-row">
            <el-tooltip :content="t('todo.remindNeedPlanEnd')" :disabled="!!form.planEnd" placement="top">
              <span class="remind-switch-wrap">
                <el-switch v-model="form.remindRule.endEnabled" :disabled="!form.planEnd" />
              </span>
            </el-tooltip>
            <template v-if="form.remindRule.endEnabled">
              <el-input-number v-model="form.remindRule.endBeforeMinutes" :min="3" :step="1" step-strictly />
              <span class="remind-unit">{{ t('todo.minutesBeforeEnd') }}</span>
            </template>
          </div>
        </el-form-item>
        <!-- 重复提醒：窗口 [目标-x, 目标] 内每隔 y 分钟（1 ≤ y ≤ x） -->
        <el-form-item :label="t('todo.repeat')">
          <el-switch v-model="form.remindRule.repeatEnabled" />
        </el-form-item>
        <template v-if="form.remindRule.repeatEnabled">
          <el-form-item :label="t('todo.repeatInterval')">
            <div class="remind-row">
              <el-input-number v-model="form.remindRule.repeatIntervalMinutes" :min="1" :max="maxRepeatInterval" :step="1" step-strictly />
              <span class="remind-unit">{{ t('todo.repeatUnit') }}</span>
            </div>
          </el-form-item>
          <div v-if="xEqualsY" class="remind-hint">{{ t('todo.repeatOnceHint') }}</div>
        </template>
      </template>
      <el-form-item>
        <el-checkbox v-model="form.pinned">{{ t('todo.pin') }}</el-checkbox>
        <el-checkbox v-model="form.shelved">{{ t('todo.shelve') }}</el-checkbox>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('actions.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">{{ t('actions.save') }}</el-button>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Plus, Rank, Close } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import { todoApi, type TodoDTO, type TodoGroupDTO, type CreateTodoPayload, type RemindRuleForm, type TodoStatus, type TodoStepDTO } from '../../api/todo'
import { apiError } from '../../api/http'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import { pinyin } from 'pinyin-pro'

const props = defineProps<{ modelValue: boolean; todo: TodoDTO | null; groups: TodoGroupDTO[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()
const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const defaultRule = (): RemindRuleForm => ({
  startEnabled: false, startBeforeMinutes: 10,
  endEnabled: false, endBeforeMinutes: 10,
  repeatEnabled: false, repeatIntervalMinutes: 5
})

/** 重复间隔上限 = 已开启提醒项的最小提前分钟数 x（1 ≤ y ≤ x） */
const maxRepeatInterval = computed(() => {
  const r = form.value.remindRule
  const xs: number[] = []
  if (r.startEnabled && r.startBeforeMinutes) xs.push(r.startBeforeMinutes)
  if (r.endEnabled && r.endBeforeMinutes) xs.push(r.endBeforeMinutes)
  return xs.length ? Math.min(...xs) : 1
})

/** x == y：提醒窗口内只会触发一次（编辑时即时提示 + 保存后 toast） */
const xEqualsY = computed(() => {
  const r = form.value.remindRule
  if (!r.repeatEnabled || !r.repeatIntervalMinutes) return false
  return (r.startEnabled && r.startBeforeMinutes === r.repeatIntervalMinutes)
    || (r.endEnabled && r.endBeforeMinutes === r.repeatIntervalMinutes)
})

const auth = useAuthStore()
const form = ref<any>({ ...emptyForm() })
const saving = ref(false)
const userOptions = ref<{ id: number; name: string; email: string }[]>([])

/** 协作人下拉：按用户名首字母分组（中文名取拼音首字母），组内按名字排序 */
const groupedUserOptions = computed(() => {
  const byGroup = new Map<string, { id: number; name: string; email: string }[]>()
  for (const u of userOptions.value) {
    const label = u.name || u.email
    const letter = firstLetter(label)
    if (!byGroup.has(letter)) byGroup.set(letter, [])
    byGroup.get(letter)!.push(u)
  }
  // 字母组按字母序排前，# 组（数字/符号等）排最后
  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      if (a === '#') return 1
      if (b === '#') return -1
      return a.localeCompare(b, 'en')
    })
    .map(([label, users]) => ({
      label,
      users: users.slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'zh'))
    }))
})

/** 取首字母：中文取拼音首字母，非字母（数字/符号等）归入 # 组 */
function firstLetter(s: string): string {
  const ch = s.trim().charAt(0)
  if (!ch) return '#'
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase()
  if (/[\u4e00-\u9fa5]/.test(ch)) {
    const py = pinyin(ch, { pattern: 'first', toneType: 'none' })
    const c = py.charAt(0).toUpperCase()
    return /[A-Z]/.test(c) ? c : '#'
  }
  return '#'
}

// ---------- 步骤（子任务） ----------
const steps = ref<TodoStepDTO[]>([])
const newStep = ref('')
// 添加步骤：点击「添加步骤」切换为输入框，enter 确认 / esc 取消 / blur 兜底
const addingStep = ref(false)
const stepInputRef = ref()

function startAddStep() {
  addingStep.value = true
  nextTick(() => stepInputRef.value?.focus())
}

function cancelAddStep() {
  addingStep.value = false
  newStep.value = ''
}

function onAddStepBlur() {
  // blur 时输入框还有内容则添加，否则直接收起
  if (newStep.value.trim()) onAddStep()
  else addingStep.value = false
}

async function onAddStep() {
  const content = newStep.value.trim()
  if (!content || !props.todo) return
  try {
    const s = await todoApi.createStep(props.todo.id, content)
    steps.value.push(s)
    newStep.value = ''
    // 保持输入框开启，支持连续添加
    nextTick(() => stepInputRef.value?.focus())
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function onToggleStep(step: TodoStepDTO) {
  const prev = step.done
  step.done = !step.done
  if (!props.todo) return
  try {
    await todoApi.updateStep(props.todo.id, step.id, { done: step.done })
  } catch (e) {
    step.done = prev
    ElMessage.error(apiError(e))
  }
}

async function onStepContent(step: TodoStepDTO, ev: Event) {
  const content = (ev.target as HTMLInputElement).value.trim()
  if (!props.todo) return
  // 内容没变不请求
  if (content === step.content) {
    ;(ev.target as HTMLInputElement).value = step.content
    return
  }
  if (!content) {
    ;(ev.target as HTMLInputElement).value = step.content
    return
  }
  const prev = step.content
  step.content = content
  try {
    await todoApi.updateStep(props.todo.id, step.id, { content })
  } catch (e) {
    step.content = prev
    ;(ev.target as HTMLInputElement).value = prev
    ElMessage.error(apiError(e))
  }
}

async function onDeleteStep(step: TodoStepDTO) {
  if (!props.todo) return
  const idx = steps.value.findIndex((s) => s.id === step.id)
  if (idx === -1) return
  steps.value.splice(idx, 1)
  try {
    await todoApi.deleteStep(props.todo.id, step.id)
  } catch (e) {
    steps.value.splice(idx, 0, step)
    ElMessage.error(apiError(e))
  }
}

async function onStepsDragEnd() {
  if (!props.todo) return
  try {
    await todoApi.reorderSteps(props.todo.id, steps.value.map((s, i) => ({ id: s.id, sort: i })))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// 清空计划时间 → 同步关闭对应提醒项（没时间就没有提醒锚点），保存时提示
let clearTip = ''
watch(() => form.value.planStart, (v, old) => {
  if (!v && old && form.value.remindRule.startEnabled) {
    form.value.remindRule.startEnabled = false
    clearTip = t('todo.remindClearTipStart')
  }
})
watch(() => form.value.planEnd, (v, old) => {
  if (!v && old && form.value.remindRule.endEnabled) {
    form.value.remindRule.endEnabled = false
    clearTip = t('todo.remindClearTipEnd')
  }
})

function emptyForm(): any {
  return {
    content: '', remark: '', groupId: null, owner: auth.user?.name || auth.user?.email || '', collaborators: [],
    planStart: null, planEnd: null, status: 'not_started' as TodoStatus, pinned: false, shelved: false,
    remindEnabled: false, remindRule: defaultRule()
  }
}

/**
 * 后端返回的完整 ISO 串（带 Z 时区，如 2026-10-14T07:30:00.000Z）转为
 * 本地无时区格式（YYYY-MM-DDTHH:mm:ss）再绑定到 date-picker：
 * picker 的 value-format 按本地时间解析，直接喂完整 ISO 会把 UTC
 * 小时当本地小时显示（差时区偏移），导致列表与编辑器时间不一致
 */
function toLocalInput(s?: string | null): string | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

onMounted(async () => {
  try {
    userOptions.value = await authApi.listUsers()
  } catch {
    // 拉取用户列表失败时降级：下拉只剩当前用户
    userOptions.value = auth.user ? [{ id: auth.user.id, name: auth.user.name || '', email: auth.user.email }] : []
  }
})

watch(() => props.todo, (todo) => {
  if (todo) {
    const rule = todo.remindRule || ({} as Partial<RemindRuleForm>)
    form.value = {
      content: todo.content, remark: todo.remark || '', groupId: todo.groupId, owner: todo.owner || '',
      collaborators: todo.collaborators || [], planStart: toLocalInput(todo.planStart), planEnd: toLocalInput(todo.planEnd),
      // sqlite tinyint 返回 0/1 数字：布尔化，避免 el-switch/el-checkbox 拿到非法值
      status: todo.status || (todo.done ? 'completed' : 'not_started'), pinned: !!todo.pinned, shelved: !!todo.shelved, remindEnabled: !!todo.remindEnabled,
      remindRule: {
        startEnabled: rule.startBeforeMinutes != null,
        startBeforeMinutes: rule.startBeforeMinutes ?? 10,
        endEnabled: rule.endBeforeMinutes != null,
        endBeforeMinutes: rule.endBeforeMinutes ?? 10,
        repeatEnabled: !!rule.repeatEnabled,
        repeatIntervalMinutes: rule.repeatIntervalMinutes ?? 5
      }
    }
    // 步骤回填（含全完成时待办标记完成——与列表语义一致）
    steps.value = (todo.steps || []).map((s) => ({ ...s, done: !!s.done }))
  } else {
    form.value = emptyForm()
    steps.value = []
  }
}, { immediate: true })

async function onSave() {
  if (!form.value.content?.trim()) {
    ElMessage.warning(t('todo.content'))
    return
  }
  // 提醒依赖时间：没时间就不允许开启对应提醒项（前端兜底，后端同样校验）
  const r = form.value.remindRule
  if (form.value.remindEnabled && r.startEnabled && !form.value.planStart) {
    ElMessage.warning(t('todo.remindNeedPlanStart'))
    return
  }
  if (form.value.remindEnabled && r.endEnabled && !form.value.planEnd) {
    ElMessage.warning(t('todo.remindNeedPlanEnd'))
    return
  }
  // 无分组时也可创建（待办落入默认分组）
  saving.value = true
  try {
    const payload: CreateTodoPayload = {
      content: form.value.content,
      remark: form.value.remark,
      groupId: form.value.groupId,
      owner: form.value.owner,
      collaborators: form.value.collaborators,
      planStart: form.value.planStart,
      planEnd: form.value.planEnd,
      status: form.value.status,
      pinned: form.value.pinned,
      shelved: form.value.shelved,
      remindEnabled: form.value.remindEnabled,
      // 剥离表单开关态：未开启的提醒项不提交对应分钟数
      remindRule: form.value.remindEnabled
        ? {
            startBeforeMinutes: r.startEnabled ? r.startBeforeMinutes : undefined,
            endBeforeMinutes: r.endEnabled ? r.endBeforeMinutes : undefined,
            repeatEnabled: r.repeatEnabled,
            repeatIntervalMinutes: r.repeatEnabled ? r.repeatIntervalMinutes : undefined
          }
        : null
    }
    const res = props.todo
      ? await todoApi.updateTodo(props.todo.id, payload)
      : await todoApi.createTodo(payload)
    emit('saved')
    visible.value = false
    ElMessage.success(t('toast.saved'))
    // 清空时间时自动关闭了对应提醒：额外告知用户
    if (clearTip) {
      ElMessage.info(clearTip)
      clearTip = ''
    }
    // x == y：后端返回「只会提醒一次」提示（保存时再次确认）
    if (res.remindNotice) ElMessage.info(res.remindNotice)
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* 提醒行：开关 + 数字输入 + 单位说明横向排列 */
.remind-row { display: flex; align-items: center; gap: 10px; }
.remind-switch-wrap { display: inline-flex; }
.remind-unit { font-size: 12px; color: var(--el-text-color-secondary); }
/* x == y 即时提示 */
.remind-hint {
  margin: -8px 0 12px; padding: 6px 10px;
  font-size: 12px; color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  border-radius: 4px;
}

/* ---------- 步骤（子任务） ---------- */
.steps-box { width: 100%; display: flex; flex-direction: column; gap: 2px; }
.step-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 2px; border-radius: 6px;
}
.step-item:hover { background: var(--el-fill-color-lighter); }
.step-input.done {
  color: var(--el-text-color-placeholder);
  text-decoration: line-through;
}
.step-drag { cursor: grab; color: var(--el-text-color-placeholder); opacity: 0; flex-shrink: 0; transition: opacity 0.15s; }
.step-item:hover .step-drag { opacity: 1; }
.step-input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 13px; color: var(--el-text-color-primary); padding: 4px 0;
}
.step-del {
  border: none; background: transparent; cursor: pointer; padding: 2px;
  color: var(--el-text-color-placeholder); opacity: 0; border-radius: 4px;
  display: inline-flex; align-items: center; transition: all 0.15s;
}
.step-item:hover .step-del { opacity: 1; }
.step-del:hover { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.step-add { padding: 2px; }
</style>
