/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent<{}, {}, any>
  export default c
}

interface Window {
  nodo: {
    selectWorkDir: () => Promise<string | null>
    selectUploadFiles: () => Promise<{ name: string; base64: string; size: number }[]>
    selectSkillFiles: () => Promise<{ name: string; base64: string; size: number }[]>
    readDirEntries: (dirPath: string) => Promise<{ dirs: { name: string; path: string }[]; files: { name: string; path: string }[] }>
    openFileWithDefaultApp: (filePath: string) => Promise<boolean>
    openInExplorer: (filePath: string) => Promise<boolean>
    createDir: (parent: string, name: string) => Promise<string>
    renameDir: (dirPath: string, newName: string) => Promise<string>
    moveDir: (src: string, destParent: string) => Promise<string>
    deleteDir: (dirPath: string) => Promise<boolean>
    createFile: (parent: string, name: string) => Promise<string>
    renameFile: (filePath: string, newName: string) => Promise<string>
    moveFile: (src: string, destParent: string) => Promise<string>
    deleteFile: (filePath: string) => Promise<boolean>
    appVersion: () => Promise<string>
    showNotification: (title: string, body: string) => Promise<boolean>
    getServerPort: () => Promise<number>
    saveAvatar: (dataUrl: string, userId: number) => Promise<string>
    resolveAvatarPath: (userId: number) => Promise<string | null>
    getLocalTheme: () => Promise<'light' | 'dark' | null>
    setLocalTheme: (mode: 'light' | 'dark') => Promise<boolean>
    setNativeTheme: (mode: 'light' | 'dark') => Promise<boolean>
    watchWorkDir: () => void
    onWorkDirChanged: (cb: () => void) => () => void
    onDeepLink: (cb: (url: string) => void) => () => void
  }
}
