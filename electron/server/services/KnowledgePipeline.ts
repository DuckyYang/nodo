import { LLMService } from './LLMService'
import { EmbeddingService } from './EmbeddingService'
import { extractText } from './FileTextExtractor'
import {
  createKnowledgeDoc,
  updateDocStatus,
  insertChunks,
  clearChunks,
  deleteKnowledgeDoc,
  listKnowledgeDocs,
  getDocContentForMerge,
  updateKnowledgeDocTitle,
  type KnowledgeDocDeps
} from './KnowledgeStore'
import type { ModelConfig } from '../entities/UserConfig'

/**
 * 知识处理流水线：
 * 1. 解析文件（pdf/docx/xlsx/md/txt）提取全文
 * 2. 调用 chat 模型按语义切块（保持上下文连续性，不破坏语义/语境）
 * 3. 向量模型对所有切片向量化后入库
 * 进度实时写入文档 status_detail（前端轮询展示）
 * 失败：状态置 error，详情写入 status_detail（可重试）
 */
export interface KnowledgeDeps extends KnowledgeDocDeps {}

/** 允许上传的类型与大小上限 */
export const KNOWLEDGE_EXTS = ['docx', 'xlsx', 'pdf', 'md', 'txt']
export const KNOWLEDGE_MAX_SIZE = 5 * 1024 * 1024

const CHUNK_PROMPT = `你是知识切片专家。把下面的文本切分为若干知识片段，用于向量检索。

切片原则：
- 尽量保证知识的连续性：同一主题/段落/表格的内容放同一切片，不破坏上下文的语义和语境
- 每个切片自包含：脱离上下文也能理解（开头可以带上必要的标题/主语背景）
- 每个切片约 200~600 字（中文）；内容自然紧密的短段落可合并，超长内容拆分时在开头保留主题句
- 保持原文用词，不要改写、总结或遗漏内容
- Markdown 标题、列表、表格尽量保持结构完整（表格不跨切片拆开）

严格返回 JSON（不要任何其他文字）：
{"chunks": ["切片1内容", "切片2内容", ...]}

若内容过短（如少于 200 字），返回单个切片即可。`

/** 解析模型输出中的 JSON（容忍围栏） */
function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  if (start === -1) return null
  const end = raw.lastIndexOf('}')
  if (end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

function clip(s: string, max: number): string {
  const t = String(s || '').trim()
  return t.length > max ? `${t.slice(0, max)}…(已截断)` : t
}

/**
 * 模型语义切片：长文本分窗喂给模型（每窗 ~8000 字符），保持窗口间衔接。
 * 模型不可用时退化为固定窗口切分（600 字 + 100 字重叠）。
 */
export async function chunkText(llm: any, text: string): Promise<string[]> {
  const WINDOW = 8000
  if (text.length <= WINDOW) {
    return llmChunkWindow(llm, text)
  }
  // 分窗处理：窗口重叠 200 字符保持衔接
  const out: string[] = []
  let pos = 0
  while (pos < text.length) {
    const win = text.slice(pos, pos + WINDOW)
    const parts = await llmChunkWindow(llm, win)
    out.push(...parts)
    pos += WINDOW - 200
    if (pos < text.length && out.length) {
      // 窗口末尾衔接：给下一窗带前一段尾部语境（提示词层面处理）
    }
  }
  return out
}

/** 单窗模型切片（失败退化为固定窗口） */
async function llmChunkWindow(llm: any, text: string): Promise<string[]> {
  const prompt = `${CHUNK_PROMPT}

=== 待切分文本 ===
${text}`
  const resp = await llm.invoke(prompt)
  const raw = typeof resp?.content === 'string' ? resp.content.trim() : ''
  const parsed = parseJsonLoose<{ chunks: string[] }>(raw)
  const chunks = (parsed?.chunks || []).map((c) => String(c || '').trim()).filter((c) => c && c.length <= 2000)
  if (chunks.length) return chunks
  console.warn('[knowledge] 模型切片输出无法解析，退化为固定窗口切分。原文前 200 字：', raw.slice(0, 200) || '(空)')
  return fixedChunk(text)
}

/** 固定窗口切分兜底：600 字 + 100 字重叠 */
export function fixedChunk(text: string, size = 600, overlap = 100): string[] {
  const out: string[] = []
  let pos = 0
  while (pos < text.length) {
    const piece = text.slice(pos, pos + size).trim()
    if (piece) out.push(piece)
    pos += size - overlap
    if (pos + size >= text.length && text.slice(pos).trim().length < 50) break
  }
  // 尾部残余
  const tail = text.slice(Math.max(0, pos)).trim()
  if (tail && tail !== out[out.length - 1]) out.push(tail)
  return out.length ? out : (text.trim() ? [text.trim()] : [])
}

/**
 * 文件型知识入库（全流程）：
 * 解析 → 模型切片（进度）→ 向量化（分批进度）→ 完成
 */
export async function processKnowledgeFile(
  deps: KnowledgeDeps,
  model: ModelConfig | null | undefined,
  docId: number,
  absPath: string
): Promise<void> {
  const setProgress = async (status: string, detail: string) => {
    await updateDocStatus(deps, docId, status, detail).catch(() => {})
  }
  try {
    // 1. 解析文件
    await setProgress('parsing', '正在解析文件…')
    const text = await extractText(absPath, 1_000_000)
    if (!text.trim()) {
      await setProgress('error', '未解析出文本内容（可能是扫描件或空文件）')
      return
    }

    // 2. 模型切片
    await setProgress('chunking', '正在调用模型进行语义切片…')
    const llm = model ? LLMService.buildFast(model, deps.userId, { temperature: 0 }) : null
    let chunks: string[]
    if (llm) {
      chunks = await chunkText(llm, text)
    } else {
      chunks = fixedChunk(text)
    }
    if (!chunks.length) {
      await setProgress('error', '切片结果为空')
      return
    }
    await setProgress('chunking', `切片完成：${chunks.length} 片`)

    // 3. 向量化入库（先清旧切片，支持重试重建）
    await clearChunks(deps, docId)
    const total = chunks.length
    await setProgress('embedding', `向量化 0/${total}`)
    // insertChunks 内部分批；这里通过批次粒度更新进度
    const BATCH = 16
    let done = 0
    for (let i = 0; i < chunks.length; i += BATCH) {
      const n = await insertChunks(deps, docId, chunks.slice(i, i + BATCH))
      done += n
      await setProgress('embedding', `向量化 ${Math.min(done, total)}/${total}`)
    }

    await updateDocStatus(deps, docId, 'done', undefined, { chunkCount: total, charCount: text.length }).catch(() => {})
  } catch (e: any) {
    console.error('[knowledge] 处理失败:', e?.message || e)
    await updateDocStatus(deps, docId, 'error', clip(e?.message || '处理失败', 500)).catch(() => {})
  }
}

/**
 * 对话型知识入库（小助理 save_knowledge 工具）：
 * 一条知识记录 + 模型切片 + 向量化
 */
export async function processKnowledgeFromChat(
  deps: KnowledgeDeps,
  model: ModelConfig | null | undefined,
  title: string,
  content: string,
  sessionId?: number
): Promise<{ docId: number; chunkCount: number }> {
  const doc = await createKnowledgeDoc(deps, {
    source: 'chat',
    title,
    sourceSession: sessionId ?? null
  })
  const setProgress = async (status: string, detail: string) => {
    await updateDocStatus(deps, doc.id, status, detail).catch(() => {})
  }
  try {
    await setProgress('chunking', '正在调用模型进行语义切片…')
    const llm = model ? LLMService.buildFast(model, deps.userId, { temperature: 0 }) : null
    const chunks = llm ? await chunkText(llm, content) : fixedChunk(content)
    if (!chunks.length) {
      await setProgress('error', '切片结果为空')
      throw new Error('切片结果为空')
    }
    await setProgress('embedding', `向量化 0/${chunks.length}`)
    await insertChunks(deps, doc.id, chunks)
    await updateDocStatus(deps, doc.id, 'done', undefined, { chunkCount: chunks.length, charCount: content.length }).catch(() => {})
    return { docId: doc.id, chunkCount: chunks.length }
  } catch (e: any) {
    await updateDocStatus(deps, doc.id, 'error', clip(e?.message || '处理失败', 500)).catch(() => {})
    throw e
  }
}

/** 依赖就绪检查（路由/工具入口用） */
export function isKnowledgePipelineReady(pg?: any, emb?: any): boolean {
  return EmbeddingService.isReady(emb) && Boolean(pg?.host && pg?.database)
}

// ==================== 对话后知识抽取（独立任务） ====================

// ---------- 进度日志缓冲（按用户隔离；同 /memories/logs 模式，前端轮询兜底 SSE 终态丢失） ----------

export interface KnowledgeLogEntry {
  at: string
  /** 流水线运行标识（一次对话一轮） */
  runId: string
  sessionId: number
  /** start / extract / search / synthesize / done / error / skip */
  step: string
  message: string
}

const KLOG_LIMIT = 200
const klogBuffer = new Map<number, KnowledgeLogEntry[]>()

function pushKLog(userId: number, entry: Omit<KnowledgeLogEntry, 'at'>) {
  const full: KnowledgeLogEntry = { ...entry, at: new Date().toISOString() }
  const arr = klogBuffer.get(userId) || []
  arr.push(full)
  if (arr.length > KLOG_LIMIT) arr.splice(0, arr.length - KLOG_LIMIT)
  klogBuffer.set(userId, arr)
  console.log(`[knowledge-extract] u${userId} s${entry.sessionId} [${entry.step}] ${entry.message}`)
}

/** 拉取某用户的知识抽取日志（前端轮询） */
export function getKnowledgeLogs(userId: number): KnowledgeLogEntry[] {
  return klogBuffer.get(userId) || []
}

/** 清空某用户的知识日志 */
export function clearKnowledgeLogs(userId: number) {
  klogBuffer.delete(userId)
}

/**
 * 知识抽取提示词：从一轮对话中提取事实性知识（区别于记忆流水线的
 * 用户画像抽取）。AI 回答中的资料结论（如联网检索结果）是主要来源。
 * 核心筛选标准：只提取「你自己不知道的」外部/时效信息。
 */
const KNOWLEDGE_EXTRACT_PROMPT = `你是知识抽取专家。从下面的一轮对话中提取值得沉淀到知识库的事实性知识。

【第一原则：只提取你（模型）训练数据中不知道或不确定的信息】
先反问自己：这些信息里哪些是我本来就知道的常识？把它们剔除。例如：
- "1+1=2"、"水在标准大气压下 100℃ 沸腾"、"珠穆朗玛峰是世界最高峰" —— 模型已知的
  稳定常识，不值得存储，跳过
- "2026年10月17日北京天气晴"、"某公司昨天发布了新产品"、"某地今天的房价数据" ——
  依赖外部实时信息，模型不可能预先知道，【正是要提取的核心目标】
判定方法：如果一条信息在搜索引擎上能搜到"新"的、随时间变化的答案，或涉及具体
日期/版本/价格/排名/新闻/天气/赛事结果，那就是模型未知的，应当提取。

典型来源（按优先级）：
- 联网检索到的资料结论（天气、新闻、产品信息、数据、技术资料）
- 对话中核实确认的时效性事实（某日的事件、某版本的数据）
- 用户主动分享的私有知识（个人经验、行业内部信息、独门方法）

不要提取：
- 模型已知的稳定常识（数学事实、地理常识、历史定论、科学定律等）
- 与用户本人相关的个人信息（名字、偏好、习惯——那属于记忆，由记忆任务负责）
- 寒暄、过程性描述、任务执行细节、纯主观观点
- 分钟级时效的内容（正在进行的比赛比分、实时股价、直播状态）

【第二原则：知识必须明确自包含，禁止相对指代】
- 所有时间必须写成绝对日期："2026年10月17日"，绝不能用"今天/明天/昨天/本周"
- 禁止代词"你/我/它/他/她/这个/那个"，必须写明具体对象
- 示例：✗ "今天北京天气晴" → ✓ "2026年10月17日，北京，晴，最高气温 17℃"
- 脱离对话语境也能完全看懂，保留必要上下文（时间、地点、对象、条件、数据来源）

每条知识要求：
- title 简短概括（≤30 字，含时间与主题，如 "2026-10-17 北京天气"）
- content 为知识完整内容，保持原文事实表述，不要改写、夸大或补充
- 相关的多条事实可合并为一条；没有值得沉淀的就返回空数组

当前日期：{DATE}（对话中的"今天"即此日期，"明天/昨天"等相对时间按此推算）

严格返回 JSON（不要任何其他文字）：
{"items": [{"title": "知识标题", "content": "知识完整内容"}]}`

/**
 * 关键词生成提示词：为新知识生成 1~2 组检索关键词，用于在现有知识库中
 * 找相关条目（同主题旧知识），供后续合并决策。关键词要覆盖主题与对象。
 */
const KEYWORD_PROMPT = `你是检索关键词专家。为下面的新知识生成 1~2 组检索关键词（每组 3~6 个词，空格分隔），用于在知识库中查找同主题的已有知识。

规则：
- 第一组：主题核心词（对象 + 主题，如 "北京 天气"）
- 第二组（可选）：换个角度的同义表述（如 "首都 气温 气象"），仅在主题较宽泛时生成
- 不要包含具体日期数值；覆盖知识的主要对象与主题即可

严格返回 JSON（不要任何其他文字）：
{"queries": ["关键词组1", "关键词组2"]}`

/**
 * 知识合成提示词：新知识候选 + 现有相关知识 → 知识库增删改决策
 * （与记忆 synthesize 同构：add 新增 / update 合并更新 / delete 推翻删除）
 */
const KNOWLEDGE_SYNTHESIZE_PROMPT = `你是知识库管理专家。下面是「本轮对话新提取的知识候选」和「知识库中检索到的相关现有知识」。请把它们合并成最终的知识库操作列表。

规则：
- 新知识与现有知识完全一致 → 跳过（不输出）
- 新知识与现有知识有【任何重叠部分】（同一对象、同一主题、同一时间段的事实） → 必须输出 update 合并到其中一条现有知识（带 id），content 为合并后的完整表述。绝不允许多条知识各自包含同一事实的重复表述；如发现多条现有知识互相重叠，也应通过 update 合并它们（更新一条、其余 delete）
- 新知识与现有知识是同一主题但更新/更全/有补充（如新一天的天气、新版数据） → 输出 update（带现有知识 id，content 为合并后的完整表述，保留历史中有价值的时间点数据）
- 新知识是完全新的主题（与现有知识无重叠） → 输出 add
- 现有知识被新知识明确推翻（数据错误、事件已失效） → 输出 delete（带 id）
- 同一主题的多条新候选可合并为一条
- update 的 content 必须是合并后的完整内容（不是差异），title 同步更新（体现合并后的范围）

严格返回 JSON（不要任何其他文字）：
{"operations": [{"action": "add|update|delete", "id": 123（update/delete 必填）, "title": "知识标题", "content": "知识完整内容"}]}

没有需要执行的操作就返回 {"operations": []}。`

/**
 * 对话后知识抽取流水线（独立任务，对话完成后异步执行）：
 * 1. 抽取智能体：从本轮对话提取事实性知识候选
 * 2. 关键词生成 → 检索现有知识库中的相关条目
 * 3. 合成智能体：新候选 + 相关旧知识 → add/update/delete 决策
 * 4. 执行决策（update/add 走模型切片 + 向量化入库；delete 删条目）
 * 失败仅记日志不阻塞聊天主链路；进度通过 onProgress 回调反馈（SSE），
 * 并写入日志缓冲（前端可轮询兜底 SSE 终态丢失）。
 */
export async function runKnowledgeExtraction(opts: {
  userId: number
  model: ModelConfig | null | undefined
  deps: KnowledgeDeps
  sessionId: number
  userMessage: string
  assistantMessage: string
  onProgress?: (p: { status: 'running' | 'done' | 'skipped' | 'error'; detail?: string; runId: string }) => void
}): Promise<{ added: number; updated: number; deleted: number }> {
  const result = { added: 0, updated: 0, deleted: 0 }
  const runId = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const log = (step: string, message: string) => pushKLog(opts.userId, { runId, sessionId: opts.sessionId, step, message })
  const progress = (p: { status: 'running' | 'done' | 'skipped' | 'error'; detail?: string }) => {
    // 终态兜底日志：无论从哪条路径结束，都保证该 runId 有 done/error 终态条目
    // （前端日志轮询依赖终态条目判定结束，否则气泡永远显示「沉淀中」）
    if (p.status !== 'running') {
      const arr = klogBuffer.get(opts.userId) || []
      const mine = arr.filter((e) => e.runId === runId)
      const last = mine[mine.length - 1]
      if (!last || (last.step !== 'done' && last.step !== 'error')) {
        log(p.status === 'error' ? 'error' : 'done', `结束：${p.detail || (p.status === 'skipped' ? '已跳过' : '完成')}`)
      }
    }
    try { opts.onProgress?.({ ...p, runId }) } catch { /* 回调失败不影响流水线 */ }
  }
  const started = Date.now()
  log('start', `开始处理（模型：${opts.model?.name || '未配置'}；用户说：「${clip(opts.userMessage, 40)}」）`)
  try {
    if (!isKnowledgePipelineReady(opts.deps.pg, opts.deps.embedding)) {
      log('skip', '跳过：知识库未配置（pg / 向量模型缺失）')
      progress({ status: 'skipped', detail: '知识库未配置' })
      return result
    }
    const llm = opts.model ? LLMService.buildFast(opts.model, opts.userId, { temperature: 0 }) : null
    if (!llm) {
      log('skip', '跳过：切片模型配置不完整')
      progress({ status: 'skipped', detail: '切片模型配置不完整' })
      return result
    }
    progress({ status: 'running' })

    // 1. 抽取事实性知识候选（注入当前日期，供模型解析"今天/明天"等相对时间）
    const today = new Date()
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`
    const extractPrompt = `${KNOWLEDGE_EXTRACT_PROMPT.replace('{DATE}', dateStr)}

=== 本轮对话 ===
【用户】
${clip(opts.userMessage, 4000)}

【小助理】
${clip(opts.assistantMessage, 8000)}`
    log('extract', '正在提取本轮对话的事实性知识候选…')
    const t1 = Date.now()
    const resp = await llm.invoke(extractPrompt)
    const text = typeof resp?.content === 'string' ? resp.content.trim() : ''
    const parsed = parseJsonLoose<{ items: any[] }>(text)
    const candidates = (parsed?.items || [])
      .map((it) => ({
        title: String(it?.title || '').trim().slice(0, 100),
        content: String(it?.content || '').trim()
      }))
      .filter((it) => it.title && it.content && it.content.length >= 20 && it.content.length <= 5000)
    log('extract', candidates.length
      ? `提取到 ${candidates.length} 条候选，耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s：${candidates.map((c) => `「${clip(c.title, 24)}」`).join('；')}`
      : `本轮对话没有可沉淀的事实性知识，耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`)
    if (!candidates.length) {
      progress({ status: 'done', detail: '本轮对话无可沉淀知识' })
      return result
    }

    // 2. 关键词生成 → 检索现有知识库（每组关键词取若干条，按 id 去重）
    const related = await searchRelatedKnowledge(llm, opts.deps, candidates)
    log('search', `检索到 ${related.length} 条相关现有知识`)
    if (related.length) {
      log('search', related.map((r) => `#${r.id}「${clip(r.title, 30)}」`).join('；'))
    }

    // 3. 合成智能体：新候选 + 相关旧知识 → 增删改决策
    log('synthesize', `正在合成最终知识操作（${candidates.length} 条候选 × ${related.length} 条相关）…`)
    const t3 = Date.now()
    const operations = await synthesizeKnowledge(llm, candidates, related)
    if (operations.length) {
      log('synthesize', `生成 ${operations.length} 个操作，耗时 ${((Date.now() - t3) / 1000).toFixed(1)}s：${operations.map((o) => `${o.action}${o.id ? '#' + o.id : ''}「${clip(o.title, 24)}」`).join('；')}`)
    } else {
      log('synthesize', `无需执行任何操作（候选与现有知识一致），耗时 ${((Date.now() - t3) / 1000).toFixed(1)}s`)
      progress({ status: 'done', detail: '知识无变化' })
      return result
    }

    // 4. 执行决策
    for (const op of operations) {
      try {
        if (op.action === 'delete' && op.id != null) {
          const ok = await deleteKnowledgeDoc(opts.deps, op.id)
          if (ok) {
            result.deleted++
            log('done', `已删除知识 #${op.id}`)
          } else {
            log('done', `删除 #${op.id} 未命中（知识不存在或归属不符）`)
          }
        } else if (op.action === 'update' && op.id != null) {
          // 更新：改标题后清旧切片 → 重新切片向量化
          const r = await updateKnowledgeContent(opts.deps, opts.model, op.id, op.title, op.content)
          result.updated++
          log('done', `已更新知识 #${op.id}：「${clip(op.title, 30)}」（${r.chunkCount} 片）`)
        } else if (op.action === 'add') {
          const r = await processKnowledgeFromChat(opts.deps, opts.model, op.title, op.content, opts.sessionId)
          result.added++
          log('done', `已新增知识：「${clip(op.title, 30)}」（${r.chunkCount} 片）`)
        }
      } catch (e: any) {
        log('error', `执行单条失败 ${op.action}${op.id ? '#' + op.id : ''}「${clip(op.title, 20)}」：${e?.message || e}`)
      }
    }
    log('done', `完成：新增 ${result.added}、更新 ${result.updated}、删除 ${result.deleted}（总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
    const parts: string[] = []
    if (result.added) parts.push(`新增 ${result.added} 条`)
    if (result.updated) parts.push(`更新 ${result.updated} 条`)
    if (result.deleted) parts.push(`删除 ${result.deleted} 条`)
    progress({ status: 'done', detail: parts.join('、') || '知识无变化' })
  } catch (e: any) {
    log('error', `流水线失败：${e?.message || e}`)
    progress({ status: 'error', detail: e?.message || '知识沉淀失败' })
  }
  return result
}

/**
 * 关键词检索现有知识：
 * 1. 用模型为新候选生成 1~2 组检索关键词（空格分词）
 * 2. 候选标题自身的实体词也作为一组查询（标题是最强信号，模型生成词遗漏时兜底）
 * 3. 逐词 ILIKE 检索知识库（整串匹配会因分词形式永远落空），按命中词数排序
 * 4. 按 id 去重合并（多组关键词结果并集）
 */
async function searchRelatedKnowledge(
  llm: any,
  deps: KnowledgeDeps,
  candidates: { title: string; content: string }[]
): Promise<{ id: number; title: string; content: string }[]> {
  try {
    const kwPrompt = `${KEYWORD_PROMPT}

=== 新知识候选 ===
${JSON.stringify(candidates.map((c) => ({ title: c.title, content: clip(c.content, 500) })), null, 2)}`
    const resp = await llm.invoke(kwPrompt)
    const text = typeof resp?.content === 'string' ? resp.content.trim() : ''
    const parsed = parseJsonLoose<{ queries: string[] }>(text)
    const modelQueries = (parsed?.queries || []).map((q) => String(q || '').trim()).filter(Boolean).slice(0, 2)
    // 候选标题实体词兜底：标题去掉日期/符号后分词（如 "2026-10-17 太原天气记录" → 太原/天气/记录）
    const titleWords = [...new Set(
      candidates.map((c) => c.title).join(' ')
        .replace(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?/g, ' ')
        .replace(/[（）()【】\[\]《》「」、，。：:;；!！?？\-—_~/]/g, ' ')
        .split(/\s+/)
    )].filter((w) => w && w.length >= 2).slice(0, 6)
    const queries = [...modelQueries, titleWords.join(' ')].filter(Boolean)
    if (!queries.length) return []
    const found = new Map<number, { id: number; title: string; content: string }>()
    for (const q of queries) {
      const words = [...new Set(q.split(/[\s,，、]+/).map((w) => w.trim()).filter(Boolean))].slice(0, 6)
      if (!words.length) continue
      // 逐词检索，统计每个文档命中的词数（过滤未完成条目）
      const hits = new Map<number, { doc: any; count: number }>()
      for (const w of words) {
        const docs = await listKnowledgeDocs(deps, w, 30)
        for (const d of docs) {
          if (d.status !== 'done') continue
          const cur = hits.get(d.id)
          if (cur) cur.count++
          else hits.set(d.id, { doc: d, count: 1 })
        }
      }
      // 词数多时要求至少命中一半（降噪），单词/双词全保留
      const minHits = words.length >= 4 ? Math.ceil(words.length / 2) : 1
      const ranked = [...hits.entries()]
        .filter(([, v]) => v.count >= minHits)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([, v]) => v.doc)
      for (const d of ranked) {
        if (found.has(d.id)) continue
        // 带上真实内容（截断），供合成智能体判断增删改
        const content = await getDocContentForMerge(deps, d.id).catch(() => '')
        found.set(d.id, { id: d.id, title: d.title, content: content || '(无内容)' })
      }
    }
    return [...found.values()].slice(0, 10)
  } catch (e: any) {
    console.warn('[knowledge-extract] 关键词检索失败（按无相关处理）：', e?.message || e)
    return []
  }
}

/** 知识合成智能体：新候选 + 相关旧知识 → 增删改操作列表 */
async function synthesizeKnowledge(
  llm: any,
  candidates: { title: string; content: string }[],
  related: { id: number; title: string; content: string }[]
): Promise<{ action: 'add' | 'update' | 'delete'; id?: number; title: string; content: string }[]> {
  const prompt = `${KNOWLEDGE_SYNTHESIZE_PROMPT}

=== 新提取的知识候选 ===
${JSON.stringify(candidates, null, 2)}

=== 相关现有知识（top ${related.length}） ===
${related.length ? JSON.stringify(related, null, 2) : '（无）'}`
  const resp = await llm.invoke(prompt)
  const text = typeof resp?.content === 'string' ? resp.content.trim() : ''
  const parsed = parseJsonLoose<{ operations: any[] }>(text)
  if (!parsed?.operations || !Array.isArray(parsed.operations)) {
    console.warn('[knowledge-extract] synthesize 输出无法解析为 JSON，原文前 300 字：', text.slice(0, 300) || '(空)')
    return []
  }
  const out: { action: 'add' | 'update' | 'delete'; id?: number; title: string; content: string }[] = []
  for (const op of parsed.operations) {
    const action = op?.action
    if (action !== 'add' && action !== 'update' && action !== 'delete') continue
    const id = Number(op?.id)
    if ((action === 'update' || action === 'delete') && !Number.isFinite(id)) continue
    const title = String(op?.title || '').trim().slice(0, 100)
    const content = String(op?.content || '').trim()
    if (action !== 'delete' && (!title || !content || content.length > 5000)) continue
    out.push({ action, id: Number.isFinite(id) ? id : undefined, title, content })
  }
  return out
}

/**
 * 更新知识内容：改标题 → 清旧切片 → 重新模型切片 + 向量化
 * （切片生成后再落库，最后一步才更新状态为 done，保证中途失败可重试）
 */
async function updateKnowledgeContent(
  deps: KnowledgeDeps,
  model: ModelConfig | null | undefined,
  docId: number,
  title: string,
  content: string
): Promise<{ chunkCount: number }> {
  await updateDocStatus(deps, docId, 'chunking', '知识更新：正在调用模型进行语义切片…')
  const llm = model ? LLMService.buildFast(model, deps.userId, { temperature: 0 }) : null
  const chunks = llm ? await chunkText(llm, content) : fixedChunk(content)
  if (!chunks.length) throw new Error('切片结果为空')
  await clearChunks(deps, docId)
  await updateDocStatus(deps, docId, 'embedding', `向量化 0/${chunks.length}`)
  await insertChunks(deps, docId, chunks)
  // 更新标题与统计
  await updateDocStatus(deps, docId, 'done', undefined, { chunkCount: chunks.length, charCount: content.length }).catch(() => {})
  await updateKnowledgeDocTitle(deps, docId, title)
  return { chunkCount: chunks.length }
}
