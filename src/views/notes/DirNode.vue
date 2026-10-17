<template>
  <li class="tree-node">
    <div class="node-row" :class="{ selected: selectedPath === node.path }"
      @click="$emit('select', node)" @contextmenu.prevent="$emit('menu', $event, node)">
      <!-- 展开箭头：仅当有子目录时显示 -->
      <span class="arrow" :class="{ expanded: expandedPaths.has(node.path), empty: !children.length }"
        @click.stop="$emit('toggle', node)">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <FolderIcon :open="expandedPaths.has(node.path)" :size="18" />
      <span class="node-name" :title="node.name">{{ node.name }}</span>
    </div>
    <!-- 子目录（递归），数据来自父级 childrenMap -->
    <ul v-if="expandedPaths.has(node.path) && children.length" class="node-list children">
      <DirNode v-for="child in children" :key="child.path" :node="child" :selected-path="selectedPath"
        :expanded-paths="expandedPaths" :children-map="childrenMap"
        @toggle="(n: DirEntry) => $emit('toggle', n)"
        @select="(n: DirEntry) => $emit('select', n)"
        @menu="(ev: MouseEvent, n: DirEntry) => $emit('menu', ev, n)" />
    </ul>
  </li>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import FolderIcon from '../../components/FolderIcon.vue'

interface DirEntry { name: string; path: string }

const props = defineProps<{
  node: DirEntry
  selectedPath: string
  expandedPaths: Set<string>
  childrenMap: Map<string, DirEntry[]>
}>()

const emit = defineEmits<{
  (e: 'toggle', node: DirEntry): void
  (e: 'select', node: DirEntry): void
  (e: 'probe', node: DirEntry): void
  (e: 'menu', ev: MouseEvent, node: DirEntry): void
}>()

const children = computed(() => props.childrenMap.get(props.node.path) ?? [])

// 挂载时探测一次子目录（用于决定是否显示展开箭头）
onMounted(() => {
  if (!props.childrenMap.has(props.node.path)) emit('probe', props.node)
})
</script>

<style scoped>
.tree-node { list-style: none; }
.node-row {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 6px;
  cursor: pointer; user-select: none;
}
.node-row:hover { background: var(--el-fill-color-light); }
.node-row.selected { background: var(--el-color-primary-light-9); }
.arrow {
  width: 14px; height: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--el-text-color-secondary);
  transition: transform 0.15s;
  cursor: pointer;
}
.arrow.expanded { transform: rotate(90deg); }
.arrow.empty { visibility: hidden; }
.node-name {
  flex: 1; min-width: 0;
  font-size: 13px; color: var(--el-text-color-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.node-row.selected .node-name { color: var(--el-color-primary); font-weight: 600; }
.node-list.children { padding-left: 14px; margin: 0; }
</style>
