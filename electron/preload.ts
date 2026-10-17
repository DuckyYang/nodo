import { contextBridge, ipcRenderer } from 'electron'

const apiKey = 'nodo'

const api = {
  // 工作目录
  selectWorkDir: (): Promise<string | null> => ipcRenderer.invoke(apiKey, 'select-work-dir'),
  selectUploadFiles: (): Promise<{ name: string; base64: string; size: number }[]> =>
    ipcRenderer.invoke(apiKey, 'select-upload-files'),
  selectSkillFiles: (): Promise<{ name: string; base64: string; size: number }[]> =>
    ipcRenderer.invoke(apiKey, 'select-skill-files'),
  readDirEntries: (dirPath: string) => ipcRenderer.invoke(apiKey, 'read-dir-entries', dirPath),
  openFileWithDefaultApp: (filePath: string) => ipcRenderer.invoke(apiKey, 'open-file-default', filePath),
  openInExplorer: (filePath: string) => ipcRenderer.invoke(apiKey, 'open-in-explorer', filePath),
  // 目录操作（笔记模块）
  createDir: (parent: string, name: string) => ipcRenderer.invoke(apiKey, 'create-dir', parent, name),
  renameDir: (dirPath: string, newName: string) => ipcRenderer.invoke(apiKey, 'rename-dir', dirPath, newName),
  moveDir: (src: string, destParent: string) => ipcRenderer.invoke(apiKey, 'move-dir', src, destParent),
  deleteDir: (dirPath: string) => ipcRenderer.invoke(apiKey, 'delete-dir', dirPath),
  // 文件操作（笔记模块）
  createFile: (parent: string, name: string) => ipcRenderer.invoke(apiKey, 'create-file', parent, name),
  renameFile: (filePath: string, newName: string) => ipcRenderer.invoke(apiKey, 'rename-file', filePath, newName),
  moveFile: (src: string, destParent: string) => ipcRenderer.invoke(apiKey, 'move-file', src, destParent),
  deleteFile: (filePath: string) => ipcRenderer.invoke(apiKey, 'delete-file', filePath),
  // 应用信息
  appVersion: () => ipcRenderer.invoke(apiKey, 'app-version'),
  // 桌面通知
  showNotification: (title: string, body: string) => ipcRenderer.invoke(apiKey, 'show-notification', title, body),
  // 内嵌后端端口
  getServerPort: () => ipcRenderer.invoke(apiKey, 'get-server-port'),
  // 头像上传
  saveAvatar: (dataUrl: string, userId: number) => ipcRenderer.invoke(apiKey, 'save-avatar', dataUrl, userId),
  resolveAvatarPath: (userId: number) => ipcRenderer.invoke(apiKey, 'resolve-avatar-path', userId),
  // 主题持久化
  getLocalTheme: () => ipcRenderer.invoke(apiKey, 'get-local-theme'),
  setLocalTheme: (mode: 'light' | 'dark') => ipcRenderer.invoke(apiKey, 'set-local-theme', mode),
  // 原生标题栏主题同步
  setNativeTheme: (mode: 'light' | 'dark') => ipcRenderer.invoke(apiKey, 'set-native-theme', mode),
  // 工作目录变化监听
  watchWorkDir: () => ipcRenderer.send(apiKey + ':watch-workdir'),
  onWorkDirChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('nodo:workdir-changed', listener)
    return () => ipcRenderer.removeListener('nodo:workdir-changed', listener)
  },
  onDeepLink: (cb: (url: string) => void) => {
    const listener = (_: unknown, url: string) => cb(url)
    ipcRenderer.on('deep-link', listener)
    return () => ipcRenderer.removeListener('deep-link', listener)
  }
}

contextBridge.exposeInMainWorld('nodo', api)

export type NodoApi = typeof api
