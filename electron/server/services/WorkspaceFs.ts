import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/** 智能体工作区根目录名（位于用户工作目录下） */
export const WORKSPACE_DIR = 'app_work_space'
/** 生成的笔记默认目录名（位于用户工作目录下） */
export const AI_NOTES_DIR = 'AI笔记'

/**
 * 创建 app_work_space 根目录并设置隐藏属性（Windows attrib +H；
 * mac/linux 以点开头天然隐藏，此处固定名称故仅 win32 需要处理）。
 * 幂等：已存在时仅补设隐藏属性。
 */
export async function ensureWorkspaceRoot(workDir: string): Promise<string> {
  const abs = path.join(workDir, WORKSPACE_DIR)
  await fsp.mkdir(abs, { recursive: true })
  if (process.platform === 'win32') {
    try {
      await execFileP('attrib', ['+H', abs])
    } catch {
      // 设置失败不影响功能（仅目录可见性）
    }
  }
  return abs
}

/** 会话上传目录：app_work_space/{sessionId|draft}/upload/（自动创建） */
export async function ensureSessionUploadDir(workDir: string, sessionId: string | number): Promise<string> {
  const root = await ensureWorkspaceRoot(workDir)
  const abs = path.join(root, String(sessionId), 'upload')
  await fsp.mkdir(abs, { recursive: true })
  return abs
}

/** 会话生成物目录：app_work_space/{sessionId|draft}/output/（自动创建，智能体生成文件用） */
export async function ensureSessionOutputDir(workDir: string, sessionId: string | number): Promise<string> {
  const root = await ensureWorkspaceRoot(workDir)
  const abs = path.join(root, String(sessionId), 'output')
  await fsp.mkdir(abs, { recursive: true })
  return abs
}

/** 是否为智能体工作区路径（相对工作目录） */
export function isWorkspacePath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/')
  return norm === WORKSPACE_DIR || norm.startsWith(`${WORKSPACE_DIR}/`)
}
