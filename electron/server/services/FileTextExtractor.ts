import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * 常规文件文本提取：供小助理 extract_file_text 工具使用。
 * 纯文本类直接读；pdf/docx/xlsx/pptx 用对应解析库。
 */

/** 支持解析的后缀（小写，不带点） */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'ini', 'conf', 'env',
  'yml', 'yaml', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'java', 'kt', 'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift',
  'sql', 'sh', 'bat', 'ps1', 'vue', 'svelte', 'gradle', 'properties', 'toml'
])

export function isExtractable(filename: string): boolean {
  const ext = path.extname(filename).slice(1).toLowerCase()
  return TEXT_EXTS.has(ext) || ['pdf', 'docx', 'xlsx', 'pptx'].includes(ext)
}

/** 提取文件文本，maxChars 截断（智能体上下文有限） */
export async function extractText(absPath: string, maxChars = 60000): Promise<string> {
  const ext = path.extname(absPath).slice(1).toLowerCase()

  let text: string
  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default as any
    const buf = await fsp.readFile(absPath)
    const r = await pdfParse(buf)
    text = r.text || ''
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const r = await mammoth.extractRawText({ path: absPath })
    text = r.value || ''
  } else if (ext === 'xlsx') {
    const XLSX = await import('xlsx')
    const wb = XLSX.readFile(absPath)
    const parts: string[] = []
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
      parts.push(`## Sheet: ${name}\n${csv}`)
    }
    text = parts.join('\n\n')
  } else if (ext === 'pptx') {
    // pptx 是 zip 包，直接解压取 slide XML 里的文本节点
    text = await extractPptxText(absPath)
  } else if (TEXT_EXTS.has(ext)) {
    text = await fsp.readFile(absPath, 'utf8')
  } else {
    throw new Error(`不支持的文件类型: .${ext}`)
  }

  text = text.replace(/\u0000/g, '').trim()
  if (text.length > maxChars) {
    return text.slice(0, maxChars) + `\n\n[内容过长，已截断，共 ${text.length} 字符]`
  }
  return text
}

/** pptx：解压读 ppt/slides/slideN.xml 的 <a:t> 文本 */
async function extractPptxText(absPath: string): Promise<string> {
  const { execSync } = await import('node:child_process')
  const os = await import('node:os')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-pptx-'))
  try {
    // Windows/跨平台解压：用 PowerShell Expand-Archive（重命名为 zip）
    const zipPath = tmpDir + '.zip'
    await fsp.copyFile(absPath, zipPath)
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'ignore' })
    } else {
      execSync(`unzip -o -q '${zipPath}' -d '${tmpDir}'`)
    }
    const slidesDir = path.join(tmpDir, 'ppt', 'slides')
    if (!fs.existsSync(slidesDir)) return ''
    const files = (await fsp.readdir(slidesDir)).filter((f) => /^slide\d+\.xml$/.test(f)).sort((a, b) => {
      const na = Number(a.match(/\d+/)![0]); const nb = Number(b.match(/\d+/)![0])
      return na - nb
    })
    const parts: string[] = []
    for (let i = 0; i < files.length; i++) {
      const xml = await fsp.readFile(path.join(slidesDir, files[i]), 'utf8')
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1])
      if (texts.length) parts.push(`## 第 ${i + 1} 页\n${texts.join('\n')}`)
    }
    return parts.join('\n\n')
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    await fsp.rm(tmpDir + '.zip', { force: true }).catch(() => {})
  }
}
