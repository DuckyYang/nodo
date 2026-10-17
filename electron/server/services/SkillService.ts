/**
 * 技能（Agent Skills）管理服务。
 *
 * 技能存放于 工作目录/agent-skills/{skill-name}/，目录内必须包含
 * SKILL.md（frontmatter 含 name/description，且 name 必须与目录名
 * 一致——deepagents SkillsMiddleware 按 Agent Skills 规范校验）。
 *
 * 来源：
 * - .zip 压缩包：解压后须能定位到 SKILL.md（允许压缩包内多一层
 *   根目录包裹），以其父目录为技能目录整体落位
 * - 单个 SKILL.md：按 frontmatter 的 name 在 agent-skills 下建目录
 *   放入
 */
import AdmZip from 'adm-zip'
import yaml from 'yaml'
import path from 'node:path'
import fs from 'node:fs/promises'

/** agent-skills 在工作目录下的目录名（deepagents skills 源路径） */
export const SKILLS_DIR_NAME = 'agent-skills'

export interface SkillInfo {
  name: string
  description: string
  /** 技能目录名（agent-skills 下的一级目录） */
  dirName: string
  /** SKILL.md 相对工作目录路径（POSIX 风格） */
  relPath: string
}

/** 解析 SKILL.md frontmatter（--- 包裹的 YAML，须含 name + description） */
export function parseSkillMd(content: string): { name: string; description: string } {
  const text = content.replace(/^\uFEFF/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) throw new Error('SKILL.md 顶部必须是 YAML frontmatter（以 --- 开始并以 --- 结束）')
  let data: any
  try {
    data = yaml.parse(m[1])
  } catch (e: any) {
    throw new Error(`SKILL.md frontmatter YAML 解析失败: ${e?.message || e}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SKILL.md frontmatter 必须是 YAML 键值对（name: xxx / description: xxx）')
  }
  const name = String(data.name ?? '').trim()
  const description = String(data.description ?? '').trim()
  if (!name) throw new Error('SKILL.md frontmatter 缺少 name 字段')
  if (!description) throw new Error('SKILL.md frontmatter 缺少 description 字段')
  return { name, description }
}

/** 校验技能名（对齐 Agent Skills 规范：小写字母/数字/单连字符，1-64 字符） */
export function validateSkillName(name: string): void {
  if (!name || name.length > 64) throw new Error('技能 name 长度须为 1-64 字符')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error('技能 name 只能包含小写字母、数字和单个连字符（不能以 - 开头或结尾）')
  }
}

/** 扫描 agent-skills 目录，返回已安装技能清单（目录名/SKILL.md 双重过滤） */
export async function listSkills(workDir: string): Promise<SkillInfo[]> {
  const skillsRoot = path.join(workDir, SKILLS_DIR_NAME)
  let dirs: string[] = []
  try {
    dirs = (await fs.readdir(skillsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return [] // 目录不存在 = 无技能
  }
  const list: SkillInfo[] = []
  for (const dirName of dirs) {
    try {
      const md = await fs.readFile(path.join(skillsRoot, dirName, 'SKILL.md'), 'utf8')
      const { name, description } = parseSkillMd(md)
      list.push({ name, description, dirName, relPath: `${SKILLS_DIR_NAME}/${dirName}/SKILL.md` })
    } catch {
      // 无 SKILL.md 或解析失败的目录跳过（deepagents 侧同样会忽略）
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 安装 .zip 技能包。
 * 规则：
 * - 压缩包内必须包含 SKILL.md（名字完全一致），允许包一层根目录
 * - 校验 frontmatter（name + description），name 须与 SKILL.md 所在
 *   目录名一致（包一层时 = 根目录名；SKILL.md 在压缩包根部时 =
 *   frontmatter name，落位时以此命名）
 * - 技能目录整体写入 工作目录/agent-skills/{name}/（同名覆盖）
 */
export async function installSkillZip(workDir: string, zipBuffer: Buffer): Promise<SkillInfo> {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipBuffer)
  } catch {
    throw new Error('无效的 zip 压缩包')
  }
  const entries = zip.getEntries()
  const skillMd = entries.find((e) => !e.isDirectory && e.entryName.replace(/\\/g, '/').split('/').pop() === 'SKILL.md')
  if (!skillMd) throw new Error('压缩包内未找到 SKILL.md 文件（文件名必须完全一致）')

  const entryPath = skillMd.entryName.replace(/\\/g, '/')
  // SKILL.md 所在目录（压缩包内相对路径），'' 表示在压缩包根部
  const innerDir = entryPath.slice(0, entryPath.length - 'SKILL.md'.length)
  // 安全检查：禁止路径穿越
  if (innerDir.includes('..')) throw new Error('压缩包内路径不合法（包含 ..）')

  const content = skillMd.getData().toString('utf8')
  const { name, description } = parseSkillMd(content)
  validateSkillName(name)

  // 技能目录名：SKILL.md 在子目录内 → 取该层目录名；在根部 → 用 frontmatter name
  let dirName: string
  if (innerDir) {
    const parts = innerDir.replace(/\/$/, '').split('/')
    dirName = parts[parts.length - 1]
  } else {
    dirName = name
  }
  if (!dirName || dirName.includes('..') || /[\\/:*?"<>|]/.test(dirName)) {
    throw new Error(`技能目录名不合法: ${dirName}`)
  }
  if (dirName !== name) {
    throw new Error(`SKILL.md 的 name（${name}）必须与其所在目录名（${dirName}）一致`)
  }

  const destDir = path.join(workDir, SKILLS_DIR_NAME, dirName)
  // 先清空旧目录（同名技能覆盖安装）
  await fs.rm(destDir, { recursive: true, force: true })
  await fs.mkdir(destDir, { recursive: true })

  // 解压技能目录内的全部条目（innerDir 前缀剥离）
  for (const entry of entries) {
    const entryNorm = entry.entryName.replace(/\\/g, '/')
    if (!entryNorm.startsWith(innerDir)) continue
    const relInside = entryNorm.slice(innerDir.length)
    if (!relInside) continue
    // 剥离后不允许再越界
    if (relInside.split('/').includes('..')) continue
    const target = path.join(destDir, relInside)
    const relCheck = path.relative(destDir, target)
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) continue
    if (entry.isDirectory) {
      await fs.mkdir(target, { recursive: true })
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, entry.getData())
    }
  }
  return { name, description, dirName, relPath: `${SKILLS_DIR_NAME}/${dirName}/SKILL.md` }
}

/**
 * 安装单个 SKILL.md：在 agent-skills 下创建与 name 同名的目录并放入。
 * name 须通过规范校验；同名目录已存在时覆盖（仅覆盖 SKILL.md 本身）。
 */
export async function installSkillMd(workDir: string, filename: string, content: string): Promise<SkillInfo> {
  const { name, description } = parseSkillMd(content)
  validateSkillName(name)
  const destDir = path.join(workDir, SKILLS_DIR_NAME, name)
  await fs.mkdir(destDir, { recursive: true })
  await fs.writeFile(path.join(destDir, 'SKILL.md'), content, 'utf8')
  return { name, description, dirName: name, relPath: `${SKILLS_DIR_NAME}/${name}/SKILL.md` }
}

/** 删除技能（移除 agent-skills 下的整个技能目录） */
export async function deleteSkill(workDir: string, dirName: string): Promise<void> {
  if (!dirName || dirName.includes('..') || /[\\/:*?"<>|]/.test(dirName)) {
    throw new Error('非法的技能目录名')
  }
  const destDir = path.join(workDir, SKILLS_DIR_NAME, dirName)
  const rel = path.relative(path.join(workDir, SKILLS_DIR_NAME), destDir)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径越界')
  await fs.rm(destDir, { recursive: true, force: true })
}
