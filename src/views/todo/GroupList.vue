<template>
  <div class="group-list">
    <!-- 智能分组（固定，不可改名/删除/拖拽） -->
    <div
      v-for="s in smartGroups"
      :key="s.key"
      class="group-item smart"
      :class="{ active: quickFilter === s.key }"
      @click="onSmartSelect(s.key)"
    >
      <el-icon class="smart-icon" :size="16"><component :is="s.iconComp" /></el-icon>
      <span class="group-name">{{ t(s.label) }}</span>
    </div>

    <div class="group-header">
      <span class="group-title">{{ t('todo.group') }}</span>
      <button class="nodo-icon-btn" type="button" @click="onAdd">
        <el-icon :size="16"><Plus /></el-icon>
      </button>
    </div>
    <draggable v-model="groups" item-key="id" :animation="150" @end="onDragEnd" handle=".drag-handle">
      <template #item="{ element }">
        <div
          class="group-item"
          :class="{ active: activeGroup === element.id && !quickFilter }"
          @click="onSelect(element)"
        >
          <el-icon class="drag-handle" :size="14"><Rank /></el-icon>
          <span class="group-name">
            <el-icon v-if="element.pinned" class="pin" :size="12"><Top /></el-icon>
            {{ element.name }}
          </span>
          <el-dropdown class="more" trigger="click" @command="onCommand($event, element)">
            <el-icon :size="14" @click.stop><MoreFilled /></el-icon>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">{{ t('actions.edit') }}</el-dropdown-item>
                <el-dropdown-item command="delete" divided>{{ t('actions.delete') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </template>
    </draggable>

    <el-dialog v-model="dialogVisible" :title="editing.id ? t('actions.edit') : t('todo.addGroup')" width="360px" append-to-body>
      <el-input v-model="editing.name" :placeholder="t('todo.groupName')" @keyup.enter="onSave" />
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" @click="onSave">{{ t('actions.ok') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { inject, ref, type Component } from 'vue'
import draggable from 'vuedraggable'
import { useI18n } from 'vue-i18n'
import { Plus, Rank, Top, MoreFilled, List, Calendar, AlarmClock, FolderAdd } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { todoApi, type TodoGroupDTO } from '../../api/todo'
import { apiError } from '../../api/http'

const { t } = useI18n()
const groups = inject('todo:groups', ref<TodoGroupDTO[]>([]))
const reloadGroups = inject('todo:reloadGroups', async () => {}) as () => Promise<void>
const activeGroup = inject('todo:activeGroup', ref<number | null>(null))
const quickFilter = inject('todo:quickFilter', ref<'uncompleted' | 'today' | 'overdue' | 'ungrouped' | undefined>(undefined))

// 智能分组：未分组（收纳无分组的待办）+ 三个筛选视图
const smartGroups: { key: 'uncompleted' | 'today' | 'overdue' | 'ungrouped'; label: string; iconComp: Component }[] = [
  { key: 'ungrouped', label: 'todo.ungrouped', iconComp: FolderAdd },
  { key: 'uncompleted', label: 'todo.allUncompleted', iconComp: List },
  { key: 'today', label: 'todo.today', iconComp: Calendar },
  { key: 'overdue', label: 'todo.overdue', iconComp: AlarmClock }
]

function onSmartSelect(key: 'uncompleted' | 'today' | 'overdue' | 'ungrouped') {
  quickFilter.value = key
  activeGroup.value = null
}

const dialogVisible = ref(false)
const editing = ref<{ id?: number; name: string; pinned?: boolean }>({ name: '' })

function onAdd() {
  editing.value = { name: '' }
  dialogVisible.value = true
}

// 三个点下拉菜单命令分发
function onCommand(cmd: string, g: TodoGroupDTO) {
  if (cmd === 'edit') {
    editing.value = { id: g.id, name: g.name, pinned: g.pinned }
    dialogVisible.value = true
  } else if (cmd === 'delete') {
    onDelete(g)
  }
}

async function onSave() {
  if (!editing.value.name.trim()) return
  try {
    if (editing.value.id) {
      await todoApi.updateGroup(editing.value.id, { name: editing.value.name })
    } else {
      await todoApi.createGroup({ name: editing.value.name })
    }
    await reloadGroups()
    dialogVisible.value = false
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function onDragEnd() {
  try {
    await todoApi.reorderGroups(groups.value.map((g, i) => ({ id: g.id, sort: i })))
    await reloadGroups()
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function onDelete(g: TodoGroupDTO) {
  try {
    await ElMessageBox.confirm(
      t('todo.deleteGroupConfirm', { name: g.name }),
      t('actions.delete'),
      { type: 'warning', confirmButtonText: t('actions.delete'), cancelButtonText: t('actions.cancel') }
    )
  } catch {
    return // 用户取消
  }
  try {
    await todoApi.deleteGroup(g.id)
    // 若删除的是当前选中分组，切换到剩余的第一个（或空）
    if (activeGroup.value === g.id) {
      const rest = groups.value.filter((x) => x.id !== g.id)
      activeGroup.value = rest.length > 0 ? rest[0].id : null
    }
    await reloadGroups()
    ElMessage.success(t('toast.deleted'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

function onSelect(g: TodoGroupDTO) {
  // 切换选中（不可取消；同时清除智能筛选）
  quickFilter.value = undefined
  activeGroup.value = g.id
}
</script>

<style scoped>
.group-list { padding: 12px 8px; }
.smart { margin-bottom: 2px; }
.smart-icon { flex-shrink: 0; }
.group-item.smart.active .smart-icon { color: inherit; }
.group-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 10px;
  padding: 4px 12px 10px; font-size: 12px; font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.nodo-icon-btn { width: 26px; height: 26px; }
.group-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 6px; cursor: pointer;
  font-size: 14px; color: var(--el-text-color-regular);
  transition: background 0.15s ease;
}
.group-item:hover { background: var(--el-fill-color-light); }
.group-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.drag-handle { cursor: grab; color: var(--el-text-color-placeholder); opacity: 0; transition: opacity 0.15s; }
.group-item:hover .drag-handle { opacity: 1; }
.group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
.group-name .pin { color: var(--el-color-warning); }
.more { opacity: 0; transition: opacity 0.2s; color: var(--el-text-color-secondary); cursor: pointer; display: inline-flex; align-items: center; }
.group-item:hover .more { opacity: 1; }
.group-item.active .more { opacity: 1; }
</style>
