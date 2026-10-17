import { ipcMain, dialog, shell, app, BrowserWindow, Notification } from 'electron'
import type { WebContents } from 'electron'
import fs, { watch, type FSWatcher } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import Store from 'electron-store'

const store = new Store<{ theme?: 'light' | 'dark' }>({ name: 'nodo-prefs', defaults: {} })

let serverPort = 7070
export function setServerPort(port: number) {
  serverPort = port
}

// 工作目录边界校验：规范化后必须在 base 之内
function isInside(base: string, target: string): boolean {
  const b = path.resolve(base)
  const t = path.resolve(base, target)
  const rel = path.relative(b, t)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function safeReadDir(dir: string, base: string): Promise<{ dirs: { name: string; path: string }[]; files: { name: string; path: string }[] }> {
  const abs = path.resolve(base, dir)
  if (!isInside(base, abs)) throw new Error('out of workdir boundary')
  const entries = await fsp.readdir(abs, { withFileTypes: true })
  const dirs: { name: string; path: string }[] = []
  const files: { name: string; path: string }[] = []
  for (const e of entries) {
    const full = path.join(abs, e.name)
    const rel = path.relative(base, full)
    // 智能体工作区目录（已设系统隐藏属性）不展示在笔记列表
    if (e.isDirectory() && e.name === 'app_work_space') continue
    if (e.isDirectory()) dirs.push({ name: e.name, path: rel })
    else if (e.isFile()) files.push({ name: e.name, path: rel })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { dirs, files }
}

// Windows 上文件/目录可能被杀毒、索引或其他程序锁定导致 EPERM/EBUSY，做短暂重试
async function retryOnLock<T>(op: () => Promise<T>, friendlyMsg: string, retries = 5): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await op()
    } catch (e: any) {
      const retryable = e?.code === 'EPERM' || e?.code === 'EBUSY' || e?.code === 'EACCES'
      if (!retryable || i === retries) {
        if (e?.code === 'EPERM' || e?.code === 'EACCES') throw new Error(friendlyMsg)
        throw e
      }
      await new Promise((r) => setTimeout(r, 150 * (i + 1)))
    }
  }
  throw new Error(friendlyMsg)
}

export function registerFileIpc() {
  ipcMain.handle('nodo', async (event, action: string, ...args: any[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    switch (action) {
      case 'select-work-dir': {
        // 默认打开当前工作目录（已设置时），便于就近切换
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        const res = await dialog.showOpenDialog(win!, {
          title: '选择笔记工作目录',
          properties: ['openDirectory', 'createDirectory'],
          ...(base ? { defaultPath: base } : {})
        })
        if (res.canceled || res.filePaths.length === 0) return null
        return res.filePaths[0]
      }
      case 'select-upload-files': {
        // 小助理上传：原生文件选择框，默认打开工作目录（未设置则上次位置）
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        const res = await dialog.showOpenDialog(win!, {
          title: '选择上传文件',
          properties: ['openFile', 'multiSelections'],
          ...(base ? { defaultPath: base } : {})
        })
        if (res.canceled || res.filePaths.length === 0) return []
        // 直接读成 base64 返回（渲染进程拼 File 走 HTTP 上传，路径不出主进程）
        const out: { name: string; base64: string; size: number }[] = []
        for (const p of res.filePaths) {
          const buf = await fsp.readFile(p)
          out.push({ name: path.basename(p), base64: buf.toString('base64'), size: buf.length })
        }
        return out
      }
      case 'select-skill-files': {
        // 技能包上传：仅 .zip / .md（SKILL.md 文件名校验在后端做，错误可提示）
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        const res = await dialog.showOpenDialog(win!, {
          title: '选择技能包',
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '技能包', extensions: ['zip', 'md'] }
          ],
          ...(base ? { defaultPath: base } : {})
        })
        if (res.canceled || res.filePaths.length === 0) return []
        const out: { name: string; base64: string; size: number }[] = []
        for (const p of res.filePaths) {
          const name = path.basename(p)
          // .zip 与 .md 放行（md 的 SKILL.md 文件名校验由后端返回明确错误）
          if (!/\.(zip|md)$/i.test(name)) {
            throw new Error('仅支持 .zip 技能压缩包或 SKILL.md 文件')
          }
          const buf = await fsp.readFile(p)
          out.push({ name, base64: buf.toString('base64'), size: buf.length })
        }
        return out
      }
      case 'read-dir-entries': {
        const dirPath = String(args[0] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        return safeReadDir(dirPath, base)
      }
      case 'open-file-default': {
        const filePath = String(args[0] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const abs = path.resolve(base, filePath)
        if (!isInside(base, abs)) throw new Error('out of workdir boundary')
        const err = await shell.openPath(abs)
        if (err) throw new Error(err)
        return true
      }
      case 'open-in-explorer': {
        // 在系统资源管理器中定位文件/目录（小助理上传文件入口用）
        const filePath = String(args[0] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const abs = path.resolve(base, filePath)
        if (!isInside(base, abs)) throw new Error('out of workdir boundary')
        shell.showItemInFolder(abs)
        return true
      }
      case 'create-dir': {
        const parent = String(args[0] ?? '')
        const name = String(args[1] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const absParent = path.resolve(base, parent)
        if (!isInside(base, absParent)) throw new Error('out of workdir boundary')
        const absNew = path.join(absParent, name)
        if (!isInside(base, absNew)) throw new Error('out of workdir boundary')
        try {
          await fsp.access(absNew)
          throw new Error('同名目录已存在')
        } catch (e: any) {
          if ((e as any)?.code !== 'ENOENT') throw e
        }
        await retryOnLock(() => fsp.mkdir(absNew, { recursive: false }), '无法创建目录，请检查权限或路径是否被占用')
        return path.relative(base, absNew)
      }
      case 'rename-dir': {
        const dirPath = String(args[0] ?? '')
        const newName = String(args[1] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const abs = path.resolve(base, dirPath)
        if (!isInside(base, abs)) throw new Error('out of workdir boundary')
        const absNew = path.join(path.dirname(abs), newName)
        if (!isInside(base, absNew)) throw new Error('out of workdir boundary')
        await retryOnLock(() => fsp.rename(abs, absNew), '目录正被其他程序占用，请关闭后重试')
        return path.relative(base, absNew)
      }
      case 'move-dir': {
        const src = String(args[0] ?? '')
        const destParent = String(args[1] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const absSrc = path.resolve(base, src)
        const absDest = path.resolve(base, destParent)
        if (!isInside(base, absSrc) || !isInside(base, absDest)) throw new Error('out of workdir boundary')
        const target = path.join(absDest, path.basename(absSrc))
        if (!isInside(base, target)) throw new Error('out of workdir boundary')
        if (absSrc === target) return path.relative(base, target)
        await retryOnLock(() => fsp.rename(absSrc, target), '目录正被其他程序占用，请关闭后重试')
        return path.relative(base, target)
      }
      case 'create-file': {
        const parent = String(args[0] ?? '')
        const name = String(args[1] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const absParent = path.resolve(base, parent)
        if (!isInside(base, absParent)) throw new Error('out of workdir boundary')
        const absNew = path.join(absParent, name)
        if (!isInside(base, absNew)) throw new Error('out of workdir boundary')
        try {
          await fsp.access(absNew)
          throw new Error('同名文件已存在')
        } catch (e: any) {
          if (e?.code !== 'ENOENT') throw e
        }
        await retryOnLock(() => fsp.writeFile(absNew, '', { flag: 'wx' }), '无法创建文件，请检查权限或路径是否被占用')
        return path.relative(base, absNew)
      }
      case 'rename-file': {
        const filePath = String(args[0] ?? '')
        const newName = String(args[1] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const abs = path.resolve(base, filePath)
        if (!isInside(base, abs)) throw new Error('out of workdir boundary')
        const absNew = path.join(path.dirname(abs), newName)
        if (!isInside(base, absNew)) throw new Error('out of workdir boundary')
        await retryOnLock(() => fsp.rename(abs, absNew), '文件正被其他程序占用（如 Excel/WPS 正在打开），请关闭后重试')
        return path.relative(base, absNew)
      }
      case 'move-file': {
        const src = String(args[0] ?? '')
        const destParent = String(args[1] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const absSrc = path.resolve(base, src)
        const absDest = path.resolve(base, destParent)
        if (!isInside(base, absSrc) || !isInside(base, absDest)) throw new Error('out of workdir boundary')
        const target = path.join(absDest, path.basename(absSrc))
        if (!isInside(base, target)) throw new Error('out of workdir boundary')
        if (absSrc === target) return path.relative(base, target)
        await retryOnLock(() => fsp.rename(absSrc, target), '文件正被其他程序占用（如 Excel/WPS 正在打开），请关闭后重试')
        return path.relative(base, target)
      }
      case 'delete-file': {
        const filePath = String(args[0] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const abs = path.resolve(base, filePath)
        if (!isInside(base, abs)) throw new Error('out of workdir boundary')
        await shell.trashItem(abs)
        return true
      }
      case 'delete-dir': {
        const dirPath = String(args[0] ?? '')
        const base = (global as any).__NODO_WORKDIR__ as string | undefined
        if (!base) throw new Error('workdir not set')
        const abs = path.resolve(base, dirPath)
        if (!isInside(base, abs)) throw new Error('out of workdir boundary')
        await shell.trashItem(abs)
        return true
      }
      case 'app-version':
        return app.getVersion()
      case 'show-notification': {
        const title = String(args[0] ?? 'Nodo')
        const body = String(args[1] ?? '')
        if (Notification.isSupported()) new Notification({ title, body }).show()
        return true
      }
      case 'get-server-port':
        return serverPort
      case 'save-avatar': {
        const dataUrl = String(args[0] ?? '')
        const userId = Number(args[1])
        const m = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/)
        if (!m) throw new Error('invalid data url')
        const ext = m[1].split('/')[1] === 'jpeg' ? 'jpg' : m[1].split('/')[1]
        const dir = path.join(app.getPath('userData'), 'avatars')
        await fsp.mkdir(dir, { recursive: true })
        const file = path.join(dir, `${userId}.${ext}`)
        await fsp.writeFile(file, Buffer.from(m[2], 'base64'))
        return file
      }
      case 'resolve-avatar-path': {
        const userId = Number(args[0])
        const dir = path.join(app.getPath('userData'), 'avatars')
        try {
          const list = await fsp.readdir(dir)
          const match = list.find((f) => f.startsWith(`${userId}.`))
          if (match) {
            const buf = await fsp.readFile(path.join(dir, match))
            const ext = match.split('.').pop()
            const mime = ext === 'jpg' ? 'jpeg' : ext
            return `data:image/${mime};base64,${buf.toString('base64')}`
          }
        } catch {}
        return null
      }
      case 'get-local-theme':
        return store.get('theme') ?? null
      case 'set-local-theme':
        store.set('theme', args[0])
        return true
      case 'set-native-theme': {
        // 同步 Electron 原生主题（标题栏/滚动条等）
        const { nativeTheme } = require('electron') as typeof import('electron')
        nativeTheme.themeSource = args[0] === 'dark' ? 'dark' : 'light'
        return true
      }
      default:
        throw new Error(`unknown ipc action: ${action}`)
    }
  })

  // 设置工作目录（由后端 /notes 模块调用以同步主进程边界校验基准）
  ipcMain.on('nodo:set-workdir', (_e, dir: string) => {
    ;(global as any).__NODO_WORKDIR__ = dir
  })

  // 订阅工作目录变化（渲染器建立监听）
  ipcMain.on('nodo:watch-workdir', (event) => {
    watchSubscribers.add(event.sender)
    // 发送方销毁时自动清理
    event.sender.once('destroyed', () => watchSubscribers.delete(event.sender))
    // 订阅时确认 watcher 已启动（渲染器可能先于后端 work-dir 接口完成订阅）
    const base = (global as any).__NODO_WORKDIR__ as string | undefined
    if (base && !workdirWatcher) startWorkdirWatcher()
  })
}

// ---------- 工作目录递归监控 ----------
const watchSubscribers = new Set<WebContents>()
let workdirWatcher: FSWatcher | null = null
// 防抖：短时间内多个事件合并成一次通知
let notifyTimer: NodeJS.Timeout | null = null

function startWorkdirWatcher() {
  const base = (global as any).__NODO_WORKDIR__ as string | undefined
  stopWorkdirWatcher()
  if (!base) {
    console.log('[notes-watch] not started: no workdir')
    return
  }
  try {
    workdirWatcher = watch(base, { recursive: true }, (_eventType, filename) => {
      console.log(`[notes-watch] event: ${_eventType} ${filename ?? ''} (subscribers: ${watchSubscribers.size})`)
      // 防抖 200ms，避免拖拽批量操作时刷屏
      if (notifyTimer) clearTimeout(notifyTimer)
      notifyTimer = setTimeout(() => {
        notifyTimer = null
        console.log(`[notes-watch] broadcast to ${watchSubscribers.size} subscriber(s)`)
        for (const wc of watchSubscribers) {
          if (!wc.isDestroyed()) wc.send('nodo:workdir-changed')
        }
      }, 200)
    })
    workdirWatcher.on('error', (err) => {
      console.error('[notes-watch] watcher error:', err)
      stopWorkdirWatcher()
    })
    console.log(`[notes-watch] watching ${base}`)
  } catch (err) {
    console.error('[notes-watch] start failed:', err)
    workdirWatcher = null
  }
}

function stopWorkdirWatcher() {
  if (workdirWatcher) {
    try { workdirWatcher.close() } catch {}
    workdirWatcher = null
  }
}

// 工具：主进程内更新工作目录（供 server 模块调用）
export function setWorkDir(dir: string | undefined) {
  if (dir && fs.existsSync(dir)) {
    ;(global as any).__NODO_WORKDIR__ = dir
    startWorkdirWatcher()
  } else {
    stopWorkdirWatcher()
  }
}
