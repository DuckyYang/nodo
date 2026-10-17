<template>
  <div class="todo-list">
    <!-- 头部：标题 + 日期同行（紧凑） -->
    <div class="todo-header">
      <div class="todo-header-left">
        <h1 class="todo-title">{{ headerTitle }}</h1>
        <span class="todo-date">{{ todayStr }}</span>
      </div>
      <div class="todo-header-actions">
        <el-dropdown trigger="click" @command="(c: string) => onBulk(c)">
          <button class="nodo-icon-btn" type="button">
            <el-icon :size="18"><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="clearDone">{{ t('todo.clearDone') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 待办列表：未完成 / 已完成 两个分区 -->
    <div class="todo-scroll" v-loading="loading">
      <div v-if="undoneList.length > 0" class="section-label">
        {{ t('todo.sectionUncompleted') }}<span class="count">{{ undoneList.length }}</span>
      </div>
      <draggable
        v-model="undoneList"
        item-key="id"
        :animation="200"
        handle=".drag-handle"
        group="todos"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <div class="todo-item" :class="{ shelved: element.shelved }">
            <el-icon class="drag-handle" :size="14"><Rank /></el-icon>
            <button
              class="check-circle"
              type="button"
              @click="onToggleDone(element)"
            ></button>
            <div class="todo-content" @click="onEdit(element)">
              <el-icon v-if="element.pinned" class="pin" :size="12"><Top /></el-icon>
              <span class="content-text">{{ element.content }}</span>
              <span v-if="element.remark" class="remark">— {{ element.remark }}</span>
              <span v-if="element.planStart" class="plan">{{ formatTime(element.planStart) }}</span>
              <el-icon v-if="element.remindEnabled" class="icon-remind" :size="12"><Bell /></el-icon>
              <!-- 步骤计数：未完成/总数 -->
              <span v-if="stepCount(element)" class="steps-count">{{ stepCount(element) }}</span>
            </div>
            <div class="todo-meta">
              <span v-if="element.owner" class="owner">{{ element.owner }}</span>
              <span class="status-tag" :class="statusOf(element)">
                <span class="status-dot"></span>{{ t(statusLabelKey(element)) }}
              </span>
              <el-dropdown trigger="click" @command="(c: string) => onCommand(c, element)">
                <button class="nodo-icon-btn" type="button">
                  <el-icon :size="16"><MoreFilled /></el-icon>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">{{ t('actions.edit') }}</el-dropdown-item>
                    <el-dropdown-item command="pin">{{ element.pinned ? t('todo.unpin') : t('todo.pin') }}</el-dropdown-item>
                    <el-dropdown-item command="shelve">{{ element.shelved ? t('todo.unshelve') : t('todo.shelve') }}</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>{{ t('actions.delete') }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </template>
      </draggable>

      <div v-if="doneList.length > 0" class="section-label done-label">
        {{ t('todo.sectionCompleted') }}<span class="count">{{ doneList.length }}</span>
      </div>
      <draggable
        v-model="doneList"
        item-key="id"
        :animation="200"
        handle=".drag-handle"
        group="todos"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <div class="todo-item done" :class="{ shelved: element.shelved }">
            <el-icon class="drag-handle" :size="14"><Rank /></el-icon>
            <button
              class="check-circle checked"
              type="button"
              @click="onToggleDone(element)"
            >
              <el-icon :size="12"><Check /></el-icon>
            </button>
            <div class="todo-content" @click="onEdit(element)">
              <span class="content-text">{{ element.content }}</span>
              <span v-if="element.remark" class="remark">— {{ element.remark }}</span>
              <!-- 步骤计数：未完成/总数 -->
              <span v-if="stepCount(element)" class="steps-count">{{ stepCount(element) }}</span>
            </div>
            <div class="todo-meta">
              <span v-if="element.owner" class="owner">{{ element.owner }}</span>
              <span class="status-tag" :class="statusOf(element)">
                <span class="status-dot"></span>{{ t(statusLabelKey(element)) }}
              </span>
              <el-dropdown trigger="click" @command="(c: string) => onCommand(c, element)">
                <button class="nodo-icon-btn" type="button">
                  <el-icon :size="16"><MoreFilled /></el-icon>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">{{ t('actions.edit') }}</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>{{ t('actions.delete') }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <!-- 底部添加任务：固定在界面最下方（不随列表滚动），智能分组视图隐藏 -->
    <div v-if="!isSmartView" class="add-task-bar">
      <button class="check-circle plus" type="button" @click="onAdd">
        <el-icon :size="14"><Plus /></el-icon>
      </button>
      <input
        v-model="newTask"
        class="add-input"
        :placeholder="t('todo.addTodoPlaceholder')"
        @keyup.enter="onQuickAdd"
      />
    </div>

    <!-- 空列表：图片 + 友好正面提示（覆盖整块内容区绝对居中，不占布局空间） -->
    <div v-if="!loading && list.length === 0" class="empty-overlay">
      <img class="empty-img" src="../../assets/logo_small.png" alt="" />
      <p>{{ emptyTip }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, watch, onMounted, onUnmounted, computed } from 'vue'
import draggable from 'vuedraggable'
import { useI18n } from 'vue-i18n'
import { Plus, Rank, Top, Bell, Hide, Check, MoreFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { todoApi, type TodoDTO, type TodoGroupDTO } from '../../api/todo'
import { apiError } from '../../api/http'

const { t, locale } = useI18n()
const groups = inject('todo:groups', ref<TodoGroupDTO[]>([]))
const activeGroup = inject('todo:activeGroup', ref<number | null>(null))
const quickFilter = inject('todo:quickFilter', ref<'uncompleted' | 'today' | 'overdue' | 'ungrouped' | undefined>(undefined))
const openEditor = inject('todo:openEditor', (_: TodoDTO | null) => {}) as (todo: TodoDTO | null) => void

const list = ref<TodoDTO[]>([])
const loading = ref(false)
const newTask = ref('')

// 未完成 / 已完成 分区（可计算属性拆分）
const undoneList = computed({
  get: () => list.value.filter((x) => !x.done),
  set: (val) => syncFromSplit(val, false)
})
const doneList = computed({
  get: () => list.value.filter((x) => x.done),
  set: (val) => syncFromSplit(val, true)
})

// 拖拽后同步：跨区拖入的条目更新 done 标记，重组 list（未完成在前、已完成在后）
// 注意：API 返回的 done/pinned 等可能是 sqlite 的 0/1 数字，比较前先布尔归一，
// 否则普通排序拖拽会被误判为跨区移动，status 被误重置
function syncFromSplit(items: TodoDTO[], targetDone: boolean) {
  const moved = items.filter((it) => !!it.done !== targetDone)
  for (const it of moved) {
    it.done = targetDone
    it.status = targetDone ? 'completed' : 'not_started'
  }
  const undone = targetDone ? list.value.filter((x) => !x.done && !items.some((i) => i.id === x.id)) : items
  const done = targetDone ? items : list.value.filter((x) => x.done && !items.some((i) => i.id === x.id))
  list.value = [...undone, ...done]
  // 持久化状态变更（done 与 status 联动；本地已同步 status，后端联动一致）
  for (const m of moved) {
    todoApi.updateTodo(m.id, { done: m.done, status: m.status }).catch(() => {
      ElMessage.error(apiError(new Error('update failed')))
      load()
    })
  }
}

const todayStr = computed(() =>
  new Date().toLocaleDateString(locale.value === 'en' ? 'en-US' : 'zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
)

const headerTitle = computed(() => {
  const g = groups.value.find((x) => x.id === activeGroup.value)
  if (g) return g.name
  if (quickFilter.value === 'today') return t('todo.today')
  if (quickFilter.value === 'overdue') return t('todo.overdue')
  if (quickFilter.value === 'uncompleted') return t('todo.allUncompleted')
  if (quickFilter.value === 'ungrouped') return t('todo.ungrouped')
  return t('menu.todo')
})

// 今日 / 未完成 / 延期三个智能分组禁止创建待办；默认分组（ungrouped）允许创建
const isSmartView = computed(() =>
  quickFilter.value === 'today' || quickFilter.value === 'uncompleted' || quickFilter.value === 'overdue'
)

// 空列表时的友好文案（正面鼓励）
const emptyTip = computed(() => {
  if (quickFilter.value === 'today') return t('todo.emptyTodayTip')
  if (quickFilter.value === 'overdue') return t('todo.emptyOverdueTip')
  if (quickFilter.value === 'uncompleted') return t('todo.emptyUncompletedTip')
  if (quickFilter.value === 'ungrouped') return t('todo.emptyUngroupedTip')
  return t('todo.emptyTip')
})

async function load() {
  loading.value = true
  try {
    const params: any = {}
    if (activeGroup.value) params.groupId = activeGroup.value
    if (quickFilter.value) params.filter = quickFilter.value
    list.value = await todoApi.listTodos(params)
  } catch (e) {
    ElMessage.error(apiError(e))
  } finally {
    loading.value = false
  }
}

watch([activeGroup, quickFilter], load)
onMounted(load)
// 编辑保存后由父组件触发列表刷新
const onReloadListReady = inject('todo:onReloadListReady', (_: () => void) => {}) as (fn: () => void) => void
onReloadListReady(() => load())

// 提醒卡片「不再提醒」等外部改动待办后刷新列表
const onTodosChanged = () => load()
window.addEventListener('nodo:todos-changed', onTodosChanged)
onUnmounted(() => window.removeEventListener('nodo:todos-changed', onTodosChanged))

function onAdd() {
  // 默认分组视图：无需普通分组即可创建
  if (quickFilter.value !== 'ungrouped' && groups.value.length === 0) {
    ElMessage.warning(t('todo.emptyGroup'))
    return
  }
  openEditor(null)
}

async function onQuickAdd() {
  const content = newTask.value.trim()
  if (!content) return
  if (quickFilter.value !== 'ungrouped' && groups.value.length === 0) {
    ElMessage.warning(t('todo.emptyGroup'))
    return
  }
  try {
    // 默认分组视图下创建无分组待办
    await todoApi.createTodo({
      content,
      groupId: quickFilter.value === 'ungrouped' ? null : activeGroup.value ?? undefined
    })
    newTask.value = ''
    await load()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

function onEdit(todo: TodoDTO) {
  openEditor(todo)
}

async function onToggleDone(todo: TodoDTO) {
  const prevDone = todo.done
  const prevStatus = todo.status
  todo.done = !todo.done
  todo.status = todo.done ? 'completed' : 'not_started'
  try {
    await todoApi.updateTodo(todo.id, { done: todo.done, status: todo.status })
  } catch (e) {
    ElMessage.error(apiError(e))
    todo.done = prevDone
    todo.status = prevStatus
  }
}

async function onCommand(cmd: string, todo: TodoDTO) {
  try {
    if (cmd === 'edit') openEditor(todo)
    else if (cmd === 'pin') {
      await todoApi.updateTodo(todo.id, { pinned: !todo.pinned })
      await load()
    } else if (cmd === 'shelve') {
      await todoApi.updateTodo(todo.id, { shelved: !todo.shelved })
      await load()
    } else if (cmd === 'delete') {
      await ElMessageBox.confirm(todo.content, t('actions.delete'), { type: 'warning' })
      await todoApi.deleteTodo(todo.id)
      await load()
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(apiError(e))
  }
}

async function onBulk(cmd: string) {
  if (cmd === 'clearDone') {
    try {
      await ElMessageBox.confirm(t('todo.clearDoneConfirm'), t('todo.clearDone'), { type: 'warning' })
      for (const item of list.value.filter((x) => x.done)) {
        await todoApi.deleteTodo(item.id)
      }
      await load()
    } catch (e) {
      if (e !== 'cancel') ElMessage.error(apiError(e))
    }
  }
}

async function onDragEnd() {
  try {
    // 两个分区合并后的顺序作为排序依据
    const ordered = [...undoneList.value, ...doneList.value]
    await todoApi.reorderTodos(ordered.map((t, i) => ({ id: t.id, sort: i })))
  } catch (e) {
    ElMessage.error(apiError(e))
    load()
  }
}

function formatTime(s: string) {
  const d = new Date(s)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 步骤计数徽标：有步骤才显示「已完成/总数」（进度形式，与勾选语义一致） */
function stepCount(t: TodoDTO): string {
  const steps = t.steps
  if (!steps || steps.length === 0) return ''
  const done = steps.filter((s) => !!s.done).length
  return `${done}/${steps.length}`
}

function overdue(t: TodoDTO) {
  return !t.done && !!t.planEnd && new Date(t.planEnd) < new Date()
}

/**
 * 四态显示状态（显示优先级）：已完成 > 已延期 > 进行中 > 未开始
 * 已延期 = 未完成且计划结束时间已过（实时推导，不落库）
 */
function statusOf(t: TodoDTO): 'completed' | 'overdue' | 'in_progress' | 'not_started' {
  if (t.done || t.status === 'completed') return 'completed'
  if (overdue(t)) return 'overdue'
  if (t.status === 'in_progress') return 'in_progress'
  return 'not_started'
}

/** 状态 → i18n key */
function statusLabelKey(t: TodoDTO): string {
  const s = statusOf(t)
  if (s === 'completed') return 'todo.statusCompleted'
  if (s === 'overdue') return 'todo.statusOverdue'
  if (s === 'in_progress') return 'todo.statusInProgress'
  return 'todo.statusNotStarted'
}
</script>

<style scoped>
.todo-list { display: flex; flex-direction: column; height: 100%; position: relative; }

/* 头部：标题与日期同行，紧凑布局 */
.todo-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 32px 8px;
}
.todo-header-left { display: flex; align-items: baseline; min-width: 0; }
.todo-title {
  margin: 0; font-size: 20px; font-weight: 700;
  color: var(--el-text-color-primary);
  letter-spacing: -0.3px;
}
.todo-date {
  margin: 0 0 0 12px; font-size: 12px;
  color: var(--el-text-color-secondary);
}
.todo-header-actions { display: flex; gap: 4px; align-self: center; }

/* 列表 */
.todo-scroll { flex: 1; overflow: auto; padding: 0 32px 16px; display: flex; flex-direction: column; }
/* 分区小标题 + 数量 */
.section-label {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 8px 6px; font-size: 12px; font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.section-label.done-label { margin-top: 12px; }
.section-label .count {
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--el-fill-color);
  font-size: 11px; font-weight: 600; color: var(--el-text-color-secondary);
  display: inline-flex; align-items: center; justify-content: center;
}
/* 空状态：绝对定位覆盖整个内容区（含头部）真正居中 */
.empty-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; pointer-events: none;
}
.empty-img { width: 88px; height: 88px; object-fit: contain; opacity: 0.9; margin-bottom: 6px; }
.empty-overlay p { margin: 0; font-size: 14px; color: var(--el-text-color-secondary); }
.todo-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: background 0.15s ease;
}
.todo-item:hover { background: var(--el-fill-color-lighter); }
.todo-item.done .content-text { color: var(--el-text-color-placeholder); text-decoration: line-through; }
.todo-item.shelved { opacity: 0.55; }

.drag-handle { cursor: grab; color: var(--el-text-color-placeholder); opacity: 0; transition: opacity 0.15s; }
.todo-item:hover .drag-handle { opacity: 1; }

/* 微软 To Do 风格圆形勾选按钮 */
.check-circle {
  width: 20px; height: 20px; min-width: 20px;
  border-radius: 50%; border: 1.5px solid var(--el-text-color-placeholder);
  background: transparent; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s ease;
}
.check-circle:hover { border-color: var(--el-color-primary); }
.check-circle.checked {
  background: var(--el-color-primary); border-color: var(--el-color-primary);
}

.check-circle.plus { border-style: dashed; margin-right: 10px; }
.check-circle.plus:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }

.todo-content {
  flex: 1; display: flex; align-items: center; gap: 6px; cursor: pointer;
  overflow: hidden; min-width: 0;
}
.content-text { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.remark { color: var(--el-text-color-secondary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan {
  font-size: 12px; color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  padding: 1px 8px; border-radius: 4px; white-space: nowrap;
}
/* 步骤计数徽标：已完成/总数 */
.steps-count {
  font-size: 12px; color: var(--el-text-color-secondary);
  background: var(--el-fill-color); padding: 1px 8px; border-radius: 4px;
  white-space: nowrap; flex-shrink: 0;
}
.icon-remind { color: var(--el-color-warning); }
.pin { color: var(--el-color-warning); flex-shrink: 0; }

.todo-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.owner {
  font-size: 12px; color: var(--el-text-color-secondary);
  background: var(--el-fill-color); padding: 2px 8px; border-radius: 4px;
}
.overdue-tag {
  font-size: 12px; color: var(--el-color-danger);
  background: var(--el-color-danger-light-9); padding: 2px 8px; border-radius: 4px;
}
/* 四态状态标签：圆点 + 文字，语义化配色（未开始=灰 / 进行中=蓝 / 已延期=红 / 已完成=绿） */
.status-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; padding: 2px 8px; border-radius: 4px;
  font-weight: 500; white-space: nowrap;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-tag.not_started { color: var(--el-text-color-secondary); background: var(--el-fill-color); }
.status-tag.not_started .status-dot { background: var(--el-text-color-placeholder); }
.status-tag.in_progress { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.status-tag.in_progress .status-dot { background: var(--el-color-primary); }
.status-tag.overdue { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.status-tag.overdue .status-dot { background: var(--el-color-danger); }
.status-tag.completed { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.status-tag.completed .status-dot { background: var(--el-color-success); }
/* 已完成条目里的状态标签弱化（正文已有删除线提示完成态） */
.todo-item.done .status-tag { opacity: 0.7; }
.nodo-icon-btn { width: 28px; height: 28px; opacity: 0; }
.todo-item:hover .nodo-icon-btn { opacity: 1; }

/* 底部快速添加：固定底栏，不随列表滚动 */
.add-task-bar {
  flex-shrink: 0;
  display: flex; align-items: center;
  margin: 8px 32px 14px;
  padding: 4px 14px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.add-task-bar:focus-within {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}
.add-task-bar:hover { border-color: var(--el-color-primary-light-5); }
.add-input {
  flex: 1; border: none; outline: none; background: transparent;
  padding: 9px 0;
  font-size: 14px; color: var(--el-text-color-primary);
}
.add-input::placeholder { color: var(--el-text-color-placeholder); }

.todo-empty { padding: 40px 0; }
</style>
