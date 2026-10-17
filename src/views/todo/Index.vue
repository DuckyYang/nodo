<template>
  <div class="nodo-page todo-page">
    <div class="todo-sidebar">
      <GroupList />
    </div>
    <div class="todo-main">
      <TodoList />
    </div>
    <TodoEditor v-model="editorVisible" :todo="editing" :groups="groups" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, provide } from 'vue'
import GroupList from './GroupList.vue'
import TodoList from './TodoList.vue'
import TodoEditor from './TodoEditor.vue'
import { todoApi, type TodoGroupDTO, type TodoDTO } from '../../api/todo'

defineOptions({ name: 'TodoIndex' })

const groups = ref<TodoGroupDTO[]>([])
const editing = ref<TodoDTO | null>(null)
const editorVisible = ref(false)

provide('todo:groups', groups)
provide('todo:reloadGroups', async () => {
  groups.value = await todoApi.listGroups()
})
provide('todo:openEditor', async (todo: TodoDTO | null) => {
  if (todo) {
    // 编辑前重新拉取最新数据：列表里的对象可能是旧缓存
    // （如「不再提醒」在提醒卡片里改了后端，列表未刷新时表单还是旧值）
    try {
      const fresh = await todoApi.getTodo(todo.id)
      editing.value = fresh
    } catch {
      editing.value = todo
    }
  } else {
    editing.value = null
  }
  editorVisible.value = true
})
const activeGroup = ref<number | null>(null)
provide('todo:activeGroup', activeGroup)
const quickFilter = ref<'uncompleted' | 'today' | 'overdue' | 'ungrouped' | undefined>(undefined)
provide('todo:quickFilter', quickFilter)

async function onSaved() {
  // 触发列表刷新
  reloadList?.()
  editorVisible.value = false
}

/** TodoList 暴露的列表刷新函数（onMounted 时注入回填） */
let reloadList: (() => void) | null = null
provide('todo:onReloadListReady', (fn: () => void) => {
  reloadList = fn
})

// 初始化：加载分组，默认选中「今天」智能分组
;(async () => {
  try {
    groups.value = await todoApi.listGroups()
  } catch {}
  quickFilter.value = 'today'
})()
</script>

<style scoped>
.todo-page { flex-direction: row; background: var(--el-bg-color); }
.todo-sidebar {
  width: 240px; flex: 0 0 240px;
  border-right: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  overflow: auto;
}
.todo-main { flex: 1; min-width: 0; overflow: hidden; }
</style>
