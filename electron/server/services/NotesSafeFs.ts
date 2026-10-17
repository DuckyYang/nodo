import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * 笔记模块的安全文件系统操作：所有路径必须在工作目录边界内。
 */
export class NotesSafeFs {
  constructor(private workDir: string | null | undefined) {
    if (workDir && !fs.existsSync(workDir)) throw new Error(`工作目录不存在: ${workDir}`)
  }

  private resolve(rel: string): string {
    if (!this.workDir) throw new Error('工作目录未设置')
    const abs = path.resolve(this.workDir, rel)
    const rel2 = path.relative(this.workDir, abs)
    if (rel2 === '' || (!rel2.startsWith('..') && !path.isAbsolute(rel2))) return abs
    throw new Error('禁止访问工作目录之外的路径')
  }

  async writeFile(rel: string, content: string): Promise<void> {
    const abs = this.resolve(rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf8')
  }

  async appendFile(rel: string, content: string): Promise<void> {
    const abs = this.resolve(rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.appendFile(abs, content, 'utf8')
  }

  async readFile(rel: string): Promise<string> {
    const abs = this.resolve(rel)
    return fsp.readFile(abs, 'utf8')
  }

  async listDir(rel: string) {
    const abs = this.resolve(rel)
    const entries = await fsp.readdir(abs, { withFileTypes: true })
    const dirs: { name: string; path: string }[] = []
    const files: { name: string; path: string }[] = []
    for (const e of entries) {
      const full = path.join(abs, e.name)
      const r = path.relative(this.workDir!, full)
      if (e.isDirectory()) dirs.push({ name: e.name, path: r })
      else if (e.isFile()) files.push({ name: e.name, path: r })
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return { dirs, files }
  }
}
