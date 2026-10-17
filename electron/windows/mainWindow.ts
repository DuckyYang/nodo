import { BrowserWindow, shell, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const store = new Store<{ bounds?: { x: number; y: number; width: number; height: number }; maximized?: boolean }>({
  name: 'window-state',
  defaults: {}
})

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const primary = screen.getPrimaryDisplay()
  const workArea = primary.workArea

  // 默认尺寸约为屏幕整体的 3/4
  const defaultWidth = Math.floor(workArea.width * 0.75)
  const defaultHeight = Math.floor(workArea.height * 0.75)

  const saved = store.get('bounds')
  const width = saved?.width ?? defaultWidth
  const height = saved?.height ?? defaultHeight
  const x = saved?.x ?? Math.floor((workArea.width - width) / 2) + workArea.x
  const y = saved?.y ?? Math.floor((workArea.height - height) / 2) + workArea.y

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    x,
    y,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon:
      process.platform === 'win32'
        ? path.join(__dirname, '../../resources/icon.ico')
        : path.join(__dirname, '../../build/icon.png'),
    title: '记了么（Nodo）',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  win.on('resize', () => {
    const [wx, wy] = win.getPosition()
    const [w, h] = win.getSize()
    store.set('bounds', { x: wx, y: wy, width: w, height: h })
  })
  win.on('move', () => {
    const [wx, wy] = win.getPosition()
    const [w, h] = win.getSize()
    store.set('bounds', { x: wx, y: wy, width: w, height: h })
  })
  win.on('maximize', () => store.set('maximized', true))
  win.on('unmaximize', () => store.set('maximized', false))

  win.on('ready-to-show', () => {
    if (store.get('maximized')) win.maximize()
    win.show()
  })

  // 开发环境加载 dev server，生产环境加载打包产物
  if (process.env.NODE_ENV === 'development' && !process.env.ELECTRON_RENDERER_URL) {
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173'
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
  return win
}
