import { app, BrowserWindow, shell, Notification } from 'electron'
import { createMainWindow, getMainWindow } from './windows/mainWindow'
import { startEmbeddedServer, bindRemindNotifier } from './server'
import { registerFileIpc } from './preload-ipc'
import { closeAllPostgresPools } from './server/services/PostgresCheckpointer'

// 单实例锁
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

// Windows 通知发件人显示应用名（否则显示 Electron XXX，通知中心按 AUMID 关联应用）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nodo.app')
}

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  // 启动内嵌后端服务（Express + TypeORM + MySQL）
  try {
    await startEmbeddedServer()
    // 待办提醒 → Electron 系统通知（点击聚焦主窗口）
    bindRemindNotifier((_userId, title, body) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => {
        const win = getMainWindow()
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
        }
      })
      n.show()
    })
  } catch (err) {
    console.error('[main] embedded server failed to start:', err)
    // 不阻塞窗口，渲染器会展示降级提示
  }

  registerFileIpc()

  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前关闭 PostgreSQL checkpointer 连接池
app.on('before-quit', () => {
  closeAllPostgresPools().catch(() => {})
})

// 外链用系统浏览器打开
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
})
