import { http } from './http'

export interface DirEntry { name: string; path: string }

export const notesApi = {
  getWorkDir: () => http.get<{ workDir: string | null }>('/notes/work-dir').then((r) => r.data.workDir),
  setWorkDir: (workDir: string) => http.put('/notes/work-dir', { workDir }).then((r) => r.data),

  // 走 preload IPC，不走 HTTP
  ipc: {
    selectWorkDir: () => window.nodo.selectWorkDir(),
    readDirEntries: (dirPath: string) => window.nodo.readDirEntries(dirPath),
    openFile: (p: string) => window.nodo.openFileWithDefaultApp(p),
    openInExplorer: (p: string) => window.nodo.openInExplorer(p),
    createDir: (parent: string, name: string) => window.nodo.createDir(parent, name),
    renameDir: (p: string, name: string) => window.nodo.renameDir(p, name),
    moveDir: (src: string, destParent: string) => window.nodo.moveDir(src, destParent),
    deleteDir: (p: string) => window.nodo.deleteDir(p),
    createFile: (parent: string, name: string) => window.nodo.createFile(parent, name),
    renameFile: (p: string, name: string) => window.nodo.renameFile(p, name),
    moveFile: (src: string, destParent: string) => window.nodo.moveFile(src, destParent),
    deleteFile: (p: string) => window.nodo.deleteFile(p)
  }
}
