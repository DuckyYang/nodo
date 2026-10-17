<template>
  <div class="nodo-page notes-page">
    <!-- 未设置工作目录 -->
    <div v-if="!workDir" class="notes-empty">
      <div class="empty-inner">
        <img src="../../assets/logo_small.png" class="empty-logo" alt="logo" />
        <p class="empty-text">{{ t('notes.notSetTip') }}</p>
        <el-button type="primary" round @click="onSelectWorkDir">{{ t('notes.selectWorkDir') }}</el-button>
      </div>
    </div>

    <div v-else class="notes-content">
      <!-- 左侧：目录树 -->
      <aside class="tree-pane">
        <div class="tree-head">
          <span class="tree-title">{{ rootLabel }}</span>
          <el-tooltip :content="t('notes.changeWorkDir')" placement="bottom">
            <el-icon class="head-btn" @click="onSelectWorkDir"><Switch /></el-icon>
          </el-tooltip>
        </div>
        <el-scrollbar class="tree-scroll">
          <!-- 根目录节点（选中态，可点击回到根目录） -->
          <div class="root-row" :class="{ selected: currentDir === '' }" @click="goTo(-1)"
            @contextmenu.prevent="onRootMenu($event)">
            <FolderIcon :open="currentDir !== ''" :size="18" />
            <span class="root-name" :title="workDir">{{ rootLabel }}</span>
          </div>
          <ul v-if="rootNodes.length" class="node-list">
            <DirNode
              v-for="node in rootNodes"
              :key="node.path"
              :node="node"
              :selected-path="currentDir"
              :expanded-paths="expandedPaths"
              :children-map="childrenMap"
              @toggle="onToggleNode"
              @select="onSelectNode"
              @probe="probeNode"
              @menu="onDirMenu"
            />
          </ul>
          <div v-else class="tree-empty">{{ t('notes.treeEmpty') }}</div>
        </el-scrollbar>
      </aside>

      <!-- 右侧：当前目录内容 -->
      <section class="file-pane">
        <header class="file-head">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item><span class="crumb-root" :class="{ active: currentDir === '' }"
                @click="goTo(-1)">{{ rootLabel }}</span></el-breadcrumb-item>
            <el-breadcrumb-item v-for="(c, i) in breadcrumbs" :key="i">
              <span class="crumb-link" @click="goTo(i)">{{ c }}</span>
            </el-breadcrumb-item>
          </el-breadcrumb>
          <div class="file-head-actions">
            <el-button text bg :icon="DocumentAdd" size="small" @click="onNewFile(currentDir)">{{ t('notes.newFile') }}</el-button>
            <el-button text bg :icon="FolderAdd" size="small" @click="onNewDir(currentDir)">{{ t('notes.newDir') }}</el-button>
          </div>
        </header>

        <el-scrollbar class="file-scroll">
          <!-- 子目录 -->
          <div v-if="entries.dirs.length" class="group-label">{{ t('notes.folders') }} · {{ entries.dirs.length }}</div>
          <div v-if="entries.dirs.length" class="dir-grid">
            <div v-for="d in entries.dirs" :key="d.path" class="dir-card" @dblclick="enter(d)"
              @contextmenu.prevent="onDirMenu($event, d)">
              <FolderIcon :open="expandedPaths.has(d.path)" :size="42" />
              <div class="dir-name" :title="d.name">{{ d.name }}</div>
            </div>
          </div>

          <!-- 文件 -->
          <div v-if="entries.files.length" class="group-label">{{ t('notes.files') }} · {{ entries.files.length }}</div>
          <div v-if="entries.files.length" class="file-list">
            <div v-for="f in entries.files" :key="f.path" class="file-row" @dblclick="openFile(f)"
              @contextmenu.prevent="onFileMenu($event, f)">
              <FileIcon :name="f.name" :size="26" />
              <span class="file-name" :title="f.name">{{ f.name }}</span>
              <el-icon class="row-more" @click.stop="onFileMenu($event, f)"><MoreFilled /></el-icon>
            </div>
          </div>

          <!-- 空目录 -->
          <div v-if="!entries.dirs.length && !entries.files.length" class="empty-dir">
            <FolderIcon :open="false" :size="64" />
            <p class="empty-dir-text">{{ t('notes.emptyDirTip') }}</p>
          </div>
        </el-scrollbar>
      </section>
    </div>

    <!-- 重命名对话框（目录/文件共用） -->
    <el-dialog v-model="renameDialog" :title="t('actions.rename')" width="360px" append-to-body>
      <el-input v-model="renameForm.name" :placeholder="renameForm.isDir ? t('notes.dirName') : t('notes.fileName')"
        @keyup.enter="onRename" />
      <template #footer>
        <el-button @click="renameDialog = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" @click="onRename">{{ t('actions.ok') }}</el-button>
      </template>
    </el-dialog>

    <!-- 移动对话框（目录/文件共用）：destroy-on-close 保证每次打开重新懒加载最新目录 -->
    <el-dialog v-model="moveDialog" :title="t('actions.move')" width="480px" append-to-body destroy-on-close>
      <div class="move-desc">{{ moveForm.srcName }}</div>
      <el-tree
        node-key="path"
        :props="{ label: 'name', children: 'children', isLeaf: 'isLeaf' }"
        :load="loadTreeNode"
        lazy
        :expand-on-click-node="true"
        @node-click="onMoveTarget"
      >
        <template #default="{ data }">
          <span class="move-node">
            <FolderIcon :open="false" :size="18" />
            <span>{{ data.name }}</span>
          </span>
        </template>
      </el-tree>
      <template #footer>
        <el-button @click="moveDialog = false">{{ t('actions.cancel') }}</el-button>
        <el-button type="primary" :disabled="!moveForm.target" @click="onMove">{{ t('notes.moveHere') }}</el-button>
      </template>
    </el-dialog>

    <!-- 目录右键/更多菜单 -->
    <div v-if="ctxMenu.show && ctxMenu.type === 'dir'" ref="ctxMenuEl" class="ctx-menu" :style="ctxMenuStyle"
      @click.stop @contextmenu.prevent>
      <div class="ctx-item" @click="ctxAction('open')">
        <el-icon><FolderOpened /></el-icon>{{ t('notes.open') }}
      </div>
      <div class="ctx-item" @click="ctxAction('newSub')">
        <el-icon><Plus /></el-icon>{{ t('notes.newSubDir') }}
      </div>
      <div class="ctx-item" @click="ctxAction('rename')">
        <el-icon><EditPen /></el-icon>{{ t('actions.rename') }}
      </div>
      <div class="ctx-item" @click="ctxAction('move')">
        <el-icon><Rank /></el-icon>{{ t('actions.move') }}
      </div>
      <div class="ctx-item danger" @click="ctxAction('delete')">
        <el-icon><Delete /></el-icon>{{ t('actions.delete') }}
      </div>
    </div>

    <!-- 根目录菜单（仅新建子目录） -->
    <div v-if="ctxMenu.show && ctxMenu.type === 'root'" ref="ctxMenuEl" class="ctx-menu" :style="ctxMenuStyle"
      @click.stop @contextmenu.prevent>
      <div class="ctx-item" @click="ctxAction('newSub')">
        <el-icon><Plus /></el-icon>{{ t('notes.newSubDir') }}
      </div>
    </div>

    <!-- 文件菜单 -->
    <div v-if="ctxMenu.show && ctxMenu.type === 'file'" ref="ctxMenuEl" class="ctx-menu" :style="ctxMenuStyle"
      @click.stop @contextmenu.prevent>
      <div class="ctx-item" @click="fileCtxAction('open')">
        <el-icon><Document /></el-icon>{{ t('notes.open') }}
      </div>
      <div class="ctx-item" @click="fileCtxAction('rename')">
        <el-icon><EditPen /></el-icon>{{ t('actions.rename') }}
      </div>
      <div class="ctx-item" @click="fileCtxAction('move')">
        <el-icon><Rank /></el-icon>{{ t('actions.move') }}
      </div>
      <div class="ctx-item danger" @click="fileCtxAction('delete')">
        <el-icon><Delete /></el-icon>{{ t('actions.delete') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, onActivated, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Switch, FolderOpened, FolderAdd, DocumentAdd, Document, EditPen, Rank, Delete, MoreFilled } from '@element-plus/icons-vue'
import { notesApi } from '../../api/notes'
import { apiError } from '../../api/http'
import FolderIcon from '../../components/FolderIcon.vue'
import FileIcon from '../../components/FileIcon.vue'
import DirNode from './DirNode.vue'

defineOptions({ name: 'NotesIndex' })

const { t } = useI18n()
const workDir = ref<string | null>(null)
const currentDir = ref<string>('')

// 左侧树数据：path -> 子目录列表
const childrenMap = reactive<Map<string, DirEntry[]>>(new Map())
const expandedPaths = reactive<Set<string>>(new Set())

const rootLabel = computed(() => {
  if (!workDir.value) return ''
  const parts = workDir.value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || workDir.value
})

const rootNodes = computed(() => childrenMap.get('') ?? [])
const breadcrumbs = computed(() => (currentDir.value ? currentDir.value.split(/[\\/]/).filter(Boolean) : []))

interface DirEntry { name: string; path: string }

// 右侧当前目录内容
const entries = reactive<{ dirs: DirEntry[]; files: { name: string; path: string }[] }>({ dirs: [], files: [] })

const renameDialog = ref(false)
const renameForm = reactive<{ path?: string; name: string; isDir: boolean }>({ name: '', isDir: true })

const moveDialog = ref(false)
const moveForm = reactive<{ src?: string; srcName?: string; target?: string; isDir: boolean }>({ isDir: true })

// 右键菜单：type = root | dir | file
const ctxMenu = reactive<{ show: boolean; x: number; y: number; type: 'root' | 'dir' | 'file'; entry: DirEntry | null }>(
  { show: false, x: 0, y: 0, type: 'dir', entry: null }
)

async function loadWorkDir() {
  try {
    workDir.value = await notesApi.getWorkDir()
    if (workDir.value) {
      currentDir.value = ''
      childrenMap.clear()
      expandedPaths.clear()
      await Promise.all([loadChildren(''), loadEntries()])
    }
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// 判断是否为"目录/文件已不存在"（外部删除或改名导致的竞态，应静默处理）
function isMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('ENOENT') || msg.includes('no such file or directory')
}

async function loadChildren(path: string) {
  try {
    const res = await notesApi.ipc.readDirEntries(path)
    // 内容未变化时跳过赋值，避免轮询引发无谓的响应式更新
    const prev = childrenMap.get(path)
    if (!prev || !sameEntries(prev, res.dirs)) childrenMap.set(path, res.dirs)
    return res.dirs
  } catch (e) {
    if (isMissing(e)) {
      // 目录已被外部删除/改名，清掉缓存静默处理
      childrenMap.delete(path)
      return []
    }
    ElMessage.error(apiError(e))
    return []
  }
}

// 比较两组目录/文件条目是否一致
function sameEntries(a: { name: string; path: string }[], b: { name: string; path: string }[]) {
  return a.length === b.length && a.every((x, i) => x.path === b[i].path && x.name === b[i].name)
}

async function loadEntries() {
  try {
    const res = await notesApi.ipc.readDirEntries(currentDir.value)
    if (!sameEntries(entries.dirs, res.dirs)) entries.dirs = res.dirs
    if (!sameEntries(entries.files, res.files)) entries.files = res.files
  } catch (e) {
    if (isMissing(e)) {
      // 当前目录已被外部删除/改名，退回根目录（避免递归：根目录不存在则静默）
      if (currentDir.value !== '') {
        currentDir.value = ''
        await loadEntries()
      }
      return
    }
    ElMessage.error(apiError(e))
  }
}

async function onSelectWorkDir() {
  try {
    const dir = await notesApi.ipc.selectWorkDir()
    if (!dir) return
    await notesApi.setWorkDir(dir)
    workDir.value = dir
    currentDir.value = ''
    childrenMap.clear()
    expandedPaths.clear()
    await Promise.all([loadChildren(''), loadEntries()])
    ElMessage.success(t('toast.saved2'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// ---------- 树交互 ----------
// 探测某目录的子目录（DirNode 挂载时触发，用于决定是否显示展开箭头）
async function probeNode(node: DirEntry) {
  if (!childrenMap.has(node.path)) await loadChildren(node.path)
}

async function onToggleNode(node: DirEntry) {
  if (expandedPaths.has(node.path)) {
    expandedPaths.delete(node.path)
  } else {
    expandedPaths.add(node.path)
    if (!childrenMap.has(node.path)) await loadChildren(node.path)
  }
}

function onSelectNode(node: DirEntry) {
  currentDir.value = node.path
  // 选中时自动展开
  if (!expandedPaths.has(node.path)) onToggleNode(node)
  loadEntries()
}

function parentPath(path: string) {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx === -1 ? '' : path.slice(0, idx)
}

function enter(d: DirEntry) {
  currentDir.value = d.path
  if (!expandedPaths.has(d.path)) onToggleNode(d)
  loadEntries()
}

function goTo(i: number) {
  currentDir.value = i < 0 ? '' : breadcrumbs.value.slice(0, i + 1).join('/')
  loadEntries()
}

async function openFile(f: { name: string; path: string }) {
  try {
    await notesApi.ipc.openFile(f.path)
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// ---------- 目录/文件操作 ----------
async function onNewDir(parent: string) {
  try {
    const name = await ElMessageBox.prompt('', t('notes.newDir'), {
      inputPlaceholder: t('notes.dirName'),
      inputValidator: (v: string) => Boolean(v && !v.includes('/') && !v.includes('\\')) || t('notes.dirName')
    })
    await notesApi.ipc.createDir(parent, name.value)
    await loadChildren(parent)
    if (parent === currentDir.value) await loadEntries()
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(apiError(e))
  }
}

async function onNewFile(parent: string) {
  try {
    const name = await ElMessageBox.prompt('', t('notes.newFile'), {
      inputPlaceholder: t('notes.fileName'),
      inputValidator: (v: string) => Boolean(v && !v.includes('/') && !v.includes('\\')) || t('notes.fileName')
    })
    await notesApi.ipc.createFile(parent, name.value)
    if (parent === currentDir.value) await loadEntries()
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(apiError(e))
  }
}

// ---------- 右键/更多菜单定位（防溢出屏幕） ----------
const ctxMenuEl = ref<HTMLElement | null>(null)
// 菜单尺寸（每次显示后测量，供边界翻转计算）
const ctxMenuSize = reactive({ w: 0, h: 0 })

const ctxMenuStyle = computed(() => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 靠近右/下边缘时向左/向上翻转，留 4px 安全边距
  const left = Math.min(ctxMenu.x, vw - ctxMenuSize.w - 4)
  const top = Math.min(ctxMenu.y, vh - ctxMenuSize.h - 4)
  return { left: Math.max(4, left) + 'px', top: Math.max(4, top) + 'px' }
})

function openCtxMenu(e: MouseEvent, type: 'root' | 'dir' | 'file', entry: DirEntry | null) {
  ctxMenu.entry = entry
  ctxMenu.type = type
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.show = true
  // 渲染后测量实际尺寸，供翻转计算
  nextTick(() => {
    if (ctxMenuEl.value) {
      ctxMenuSize.w = ctxMenuEl.value.offsetWidth
      ctxMenuSize.h = ctxMenuEl.value.offsetHeight
    }
  })
}

function onDirMenu(e: MouseEvent, d: DirEntry) {
  openCtxMenu(e, 'dir', d)
}

function onRootMenu(e: MouseEvent) {
  openCtxMenu(e, 'root', null)
}

function onFileMenu(e: MouseEvent, f: { name: string; path: string }) {
  openCtxMenu(e, 'file', { name: f.name, path: f.path })
}

async function ctxAction(action: string) {
  const d = ctxMenu.entry
  const isRoot = ctxMenu.type === 'root'
  ctxMenu.show = false
  if (!d && !isRoot) return
  if (action === 'open') {
    if (d) enter(d)
  } else if (action === 'newSub') {
    await onNewDir(isRoot ? '' : d?.path ?? currentDir.value)
  } else if (action === 'rename') {
    if (!d) return
    renameForm.path = d.path
    renameForm.name = d.name
    renameForm.isDir = true
    renameDialog.value = true
  } else if (action === 'move') {
    if (!d) return
    await startMove(d.path, d.name, true)
  } else if (action === 'delete') {
    if (!d) return
    try {
      await ElMessageBox.confirm(t('notes.deleteConfirm'), t('actions.delete'), { type: 'warning' })
      await notesApi.ipc.deleteDir(d.path)
      // 清理树状态
      expandedPaths.delete(d.path)
      for (const key of [...childrenMap.keys()]) {
        if (key === d.path || key.startsWith(d.path + '/') || key.startsWith(d.path + '\\')) childrenMap.delete(key)
      }
      // 若删的是当前目录，退回父目录
      const wasCurrent = currentDir.value === d.path || currentDir.value.startsWith(d.path + '/') || currentDir.value.startsWith(d.path + '\\')
      if (wasCurrent) currentDir.value = parentPath(d.path)
      await loadChildren(parentPath(d.path))
      await loadEntries()
      ElMessage.success(t('toast.deleted'))
    } catch (e) {
      if (e !== 'cancel') ElMessage.error(apiError(e))
    }
  }
}

async function fileCtxAction(action: string) {
  const f = ctxMenu.entry
  ctxMenu.show = false
  if (!f) return
  if (action === 'open') {
    await openFile(f)
  } else if (action === 'rename') {
    renameForm.path = f.path
    renameForm.name = f.name
    renameForm.isDir = false
    renameDialog.value = true
  } else if (action === 'move') {
    await startMove(f.path, f.name, false)
  } else if (action === 'delete') {
    try {
      await ElMessageBox.confirm(t('notes.deleteFileConfirm'), t('actions.delete'), { type: 'warning' })
      await notesApi.ipc.deleteFile(f.path)
      await loadEntries()
      ElMessage.success(t('toast.deleted'))
    } catch (e) {
      if (e !== 'cancel') ElMessage.error(apiError(e))
    }
  }
}

async function onRename() {
  if (!renameForm.path) return
  const oldPath = renameForm.path
  const newName = renameForm.name
  const isDir = renameForm.isDir
  try {
    if (isDir) {
      await notesApi.ipc.renameDir(oldPath, newName)
      const parent = parentPath(oldPath)
      const newPath = parent ? parent + '/' + newName : newName
      // 重映射 expandedPaths 与 childrenMap 的缓存键
      for (const p of [...expandedPaths]) {
        if (p === oldPath || p.startsWith(oldPath + '/') || p.startsWith(oldPath + '\\')) {
          expandedPaths.delete(p)
          expandedPaths.add(newPath + p.slice(oldPath.length))
        }
      }
      for (const k of [...childrenMap.keys()]) {
        if (k === oldPath || k.startsWith(oldPath + '/') || k.startsWith(oldPath + '\\')) {
          childrenMap.set(newPath + k.slice(oldPath.length), childrenMap.get(k)!)
          childrenMap.delete(k)
        }
      }
      // 修正 currentDir
      if (currentDir.value === oldPath || currentDir.value.startsWith(oldPath + '/') || currentDir.value.startsWith(oldPath + '\\')) {
        currentDir.value = newPath + currentDir.value.slice(oldPath.length)
      }
      await loadChildren(parent)
      if (currentDir.value === parent) await loadEntries()
    } else {
      await notesApi.ipc.renameFile(oldPath, newName)
      if (currentDir.value === parentPath(oldPath)) await loadEntries()
    }
    renameDialog.value = false
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

async function startMove(src: string, srcName: string, isDir: boolean) {
  moveForm.src = src
  moveForm.srcName = srcName
  moveForm.isDir = isDir
  moveForm.target = undefined
  // 根节点由 lazy loadTreeNode 的 level 0 加载
  moveDialog.value = true
}

async function loadTreeNode(node: any, resolve: (data: any[]) => void) {
  if (node.level === 0) {
    const res = await notesApi.ipc.readDirEntries('')
    return resolve(res.dirs.map((d) => ({ name: d.name, path: d.path, isLeaf: false })))
  }
  const res = await notesApi.ipc.readDirEntries(node.data.path)
  resolve(res.dirs.map((d) => ({ name: d.name, path: d.path, isLeaf: false })))
}

function onMoveTarget(node: any) {
  moveForm.target = node.path ?? node.data?.path
}

async function onMove() {
  if (!moveForm.src || !moveForm.target) return
  try {
    if (moveForm.isDir) {
      await notesApi.ipc.moveDir(moveForm.src, moveForm.target)
      await loadChildren(parentPath(moveForm.src))
    } else {
      await notesApi.ipc.moveFile(moveForm.src, moveForm.target)
    }
    if (currentDir.value === parentPath(moveForm.src) || currentDir.value === moveForm.target) await loadEntries()
    moveDialog.value = false
    ElMessage.success(t('toast.saved'))
  } catch (e) {
    ElMessage.error(apiError(e))
  }
}

// 全局点击关闭右键菜单
function onGlobalClick() {
  ctxMenu.show = false
}

// ---------- 工作目录实时监控 ----------
// 任何变化（应用内操作或资源管理器外部改动）都同步刷新界面
let fsSyncTimer: number | null = null
function onWorkDirChanged() {
  console.log('[notes-sync] workdir changed event received')
  // 防抖：与主进程 200ms 防抖叠加后再兜底，避免拖拽批量操作反复刷新
  if (fsSyncTimer) window.clearTimeout(fsSyncTimer)
  fsSyncTimer = window.setTimeout(async () => {
    fsSyncTimer = null
    // 刷新已缓存的所有目录（树中已展开/探测过的节点；已消失的会被 loadChildren 静默清缓存）
    const paths = [...childrenMap.keys()]
    await Promise.all(paths.map((p) => loadChildren(p)))
    // 级联清理：父级已不存在或父级子列表中已无此目录的缓存
    let removed = true
    while (removed) {
      removed = false
      for (const p of [...childrenMap.keys()]) {
        if (p === '') continue
        const parent = parentPath(p)
        const parentChildren = childrenMap.get(parent) ?? []
        const parentExists = parent === '' || parentChildren.some((c) => c.path === p)
        if (!parentExists) {
          childrenMap.delete(p)
          expandedPaths.delete(p)
          removed = true
        }
      }
    }
    await loadEntries()
  }, 300)
}

let offWorkDirChanged: (() => void) | null = null
let pollTimer: number | null = null

onMounted(() => {
  loadWorkDir()
  window.addEventListener('click', onGlobalClick)
  // 订阅主进程的目录变化广播（旧 preload 可能无此方法，可选调用）
  window.nodo.watchWorkDir?.()
  offWorkDirChanged = window.nodo.onWorkDirChanged?.(onWorkDirChanged) ?? null
  // 兜底轮询：fs.watch 在个别环境/网盘目录可能失效，3 秒兜底同步一次
  pollTimer = window.setInterval(() => onWorkDirChanged(), 3000)
})

/** keep-alive 切回：同步一次目录内容（保留当前路径/展开状态） */
onActivated(() => {
  onWorkDirChanged()
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onGlobalClick)
  offWorkDirChanged?.()
  if (fsSyncTimer) window.clearTimeout(fsSyncTimer)
  if (pollTimer) window.clearInterval(pollTimer)
})
</script>

<style scoped>
.notes-page { padding: 0; }

/* 未设置工作目录 */
.notes-empty {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: var(--el-bg-color);
}
.empty-inner { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.empty-logo { width: 88px; height: 88px; object-fit: contain; }
.empty-text { color: var(--el-text-color-secondary); font-size: 14px; margin: 0 0 14px; }

/* 主体两栏 */
.notes-content { display: flex; height: 100%; overflow: hidden; }

/* 左侧树 */
.tree-pane {
  width: 260px; min-width: 200px;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.tree-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 8px;
}
.tree-title {
  font-size: 15px; font-weight: 600; color: var(--el-text-color-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.head-btn { cursor: pointer; color: var(--el-text-color-secondary); font-size: 16px; flex-shrink: 0; }
.head-btn:hover { color: var(--el-color-primary); }
.tree-scroll { flex: 1; }
/* 根目录节点 */
.root-row {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 8px; margin: 0 6px; border-radius: 6px;
  cursor: pointer; user-select: none;
}
.root-row:hover { background: var(--el-fill-color-light); }
.root-row.selected { background: var(--el-color-primary-light-9); }
.root-name {
  flex: 1; min-width: 0;
  font-size: 13px; font-weight: 600; color: var(--el-text-color-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.root-row.selected .root-name { color: var(--el-color-primary); }
.node-list { list-style: none; padding: 2px 6px; margin: 0; }
.tree-empty { padding: 24px 16px; color: var(--el-text-color-secondary); font-size: 13px; text-align: center; }

/* 右侧内容区 */
.file-pane { flex: 1; position: relative; display: flex; flex-direction: column; min-width: 0; background: var(--el-bg-color); overflow: hidden; }
.file-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px 10px;
}
.file-head-actions { display: flex; gap: 8px; }
.crumb-root { cursor: pointer; color: var(--el-text-color-regular); }
.crumb-root:hover { color: var(--el-color-primary); }
.crumb-link { cursor: pointer; }
.crumb-link:hover { color: var(--el-color-primary); }
.file-scroll { flex: 1; padding: 0 24px 24px; }

.group-label {
  font-size: 12px; color: var(--el-text-color-secondary);
  margin: 14px 0 8px; font-weight: 600;
}

/* 目录卡片 */
.dir-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.dir-card {
  width: 104px; padding: 12px 8px 10px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  border-radius: 10px; cursor: default;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}
.dir-card:hover { background: var(--el-fill-color-light); border-color: var(--el-border-color-lighter); }
.dir-card:active { background: var(--el-fill-color); }
.dir-name {
  font-size: 12px; color: var(--el-text-color-primary);
  max-width: 100%; text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 文件行 */
.file-list { display: flex; flex-direction: column; gap: 2px; }
.file-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 8px; cursor: default;
}
.file-row:hover { background: var(--el-fill-color-light); }
.file-row:active { background: var(--el-fill-color); }
.file-name {
  flex: 1; min-width: 0;
  font-size: 13px; color: var(--el-text-color-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row-more {
  flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 15px;
  opacity: 0; cursor: pointer; padding: 2px; border-radius: 4px;
}
.file-row:hover .row-more { opacity: 1; }
.row-more:hover { color: var(--el-color-primary); background: var(--el-fill-color); }
.crumb-root.active { color: var(--el-color-primary); font-weight: 600; }

/* 空目录提示（覆盖整页居中） */
.empty-dir {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; pointer-events: none;
}
.empty-dir-text { color: var(--el-text-color-secondary); font-size: 13px; margin: 0; }

/* 移动对话框 */
.move-desc { font-size: 14px; font-weight: 600; margin-bottom: 10px; word-break: break-all; }
.move-node { display: inline-flex; align-items: center; gap: 6px; }

/* 自定义右键菜单 */
.ctx-menu {
  position: fixed; z-index: 3000;
  min-width: 160px; padding: 4px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
}
.ctx-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 6px;
  font-size: 13px; color: var(--el-text-color-primary);
  cursor: pointer; user-select: none;
}
.ctx-item:hover { background: var(--el-fill-color-light); }
.ctx-item.danger { color: var(--el-color-danger); }
.ctx-item.danger:hover { background: var(--el-color-danger-light-9); }
</style>
