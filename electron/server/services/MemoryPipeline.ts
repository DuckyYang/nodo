import { LLMService } from './LLMService'
import { EmbeddingService } from './EmbeddingService'
import { searchMemories, insertMemory, updateMemory, deleteMemory, type MemoryStoreDeps, type MemoryKind } from './MemoryStore'
import type { ModelConfig } from '../entities/UserConfig'

/**
 * 记忆流水线（对话结束后异步执行，不阻塞回复流）：
 *
 * 1. 记忆抽取智能体（extract）：
 *    从用户消息与 AI 消息中提取与用户本人相关的画像信息
 *    （事实知识/行为习惯/性格偏好/操作经验），带可信度评分，
 *    结构化返回记忆候选
 * 2. 相关性检索：以候选为查询向量检索现有记忆 top10
 * 3. 记忆合成智能体（synthesize）：将新候选与相关旧记忆组装，
 *    生成最终记忆片段并标注 add / update / delete，结构化返回
 * 4. 执行：按标注对 node_memory 表执行增删改
 *
 * 模型调用走 buildFast（非流式 + 关思考），尽量提高速度。
 * 失败仅记日志不阻塞聊天主链路；进度写入内存日志缓冲（/memories/logs 拉取）。
 */
export interface MemoryCandidate {
  kind: MemoryKind
  content: string
  category: string
  confidence: number
}

export interface SynthesizedMemory {
  action: 'add' | 'update' | 'delete'
  /** update/delete 必填：关联的现有记忆 id */
  id?: number
  kind: MemoryKind
  content: string
  category: string
  confidence: number
}

// ==================== 进度日志缓冲（按用户隔离，前端轮询展示） ====================

export interface MemoryLogEntry {
  at: string
  /** 流水线运行标识（一次对话一轮） */
  runId: string
  sessionId: number
  /** start / extract / search / synthesize / done / error */
  step: string
  message: string
}

/** 每用户最多保留的日志条数 */
const LOG_LIMIT = 200
const logBuffer = new Map<number, MemoryLogEntry[]>()

/** 追加一条记忆流水线日志（同时输出到控制台） */
function pushLog(userId: number, entry: Omit<MemoryLogEntry, 'at'>) {
  const full: MemoryLogEntry = { ...entry, at: new Date().toISOString() }
  const arr = logBuffer.get(userId) || []
  arr.push(full)
  if (arr.length > LOG_LIMIT) arr.splice(0, arr.length - LOG_LIMIT)
  logBuffer.set(userId, arr)
  console.log(`[memory-pipeline] u${userId} s${entry.sessionId} [${entry.step}] ${entry.message}`)
}

/** 拉取某用户的记忆流水线日志（前端轮询） */
export function getMemoryLogs(userId: number): MemoryLogEntry[] {
  return logBuffer.get(userId) || []
}

/** 清空某用户的记忆日志 */
export function clearMemoryLogs(userId: number) {
  logBuffer.delete(userId)
}

// ==================== 工具 ====================

/** 解析模型输出中的 JSON（容忍 ```json 围栏、前后杂文） */
function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const startArr = raw.indexOf('[')
  const from = start === -1 ? startArr : (startArr === -1 ? start : Math.min(start, startArr))
  if (from === -1) return null
  const endObj = raw.lastIndexOf('}')
  const endArr = raw.lastIndexOf(']')
  const to = Math.max(endObj, endArr)
  if (to <= from) return null
  try {
    return JSON.parse(raw.slice(from, to + 1)) as T
  } catch {
    return null
  }
}

const CATEGORY_OPTIONS = 'fact（事实知识）/ behavior（行为习惯）/ preference（性格偏好）/ experience（操作经验）'

const EXTRACT_PROMPT = `你是记忆抽取专家。从下面的一轮对话中提取值得长期记住的、与用户本人相关的信息，作为小助理对该用户的了解（用户画像）。AI 的回答内容本身不要提取（对话中的事实性知识由独立的知识抽取任务负责），但 AI 回答中如果带出了用户的补充信息（如用户确认、纠正了自己的情况）则要提取。

提取范围（用户画像维度）：
- 基本信息：名字/昵称、年龄、性别、所在地、时区
- 身份职业：职业、职位、公司、专业领域、技能
- 家庭社交：婚姻、子女、宠物、朋友、常联系的人
- 工作习惯：作息时间、常用工具、工作流程、工作偏好
- 偏好兴趣：喜好与厌恶（食物、颜色、风格）、兴趣爱好、娱乐方式
- 关注话题：长期关注的城市天气、球队、新闻领域、行业动态
- 沟通偏好：喜欢简洁还是详细、正式还是轻松、中文还是英文
- 目标计划：学习计划、项目目标、健身计划、出行安排
- 健康情况：饮食禁忌、过敏、身体状况（用户主动提及的）
- 重要资产：设备、账号、住址、常去地点（用户主动提及的）

提取规则：
- 只提取稳定、可复用的用户信息；寒暄、过程性描述、一次性任务细节不要提取
- 每条记忆独立完整、自包含（脱离对话也能看懂，含必要的上下文如时间、地点）
- 每条给出可信度 confidence（0~1 的小数，越肯定越高）
- 没有值得记的就返回空数组

严格返回 JSON（不要任何其他文字）：
{"memories": [{"content": "记忆内容", "category": "fact|behavior|preference|experience", "confidence": 0.9}]}

类别只能从 ${CATEGORY_OPTIONS} 中选一。`

const SYNTHESIZE_PROMPT = `你是记忆管理专家。下面是「新提取的记忆候选」和「数据库中检索到的相关现有记忆」。请把它们合并成最终的记忆库操作列表。

规则：
- 新信息与现有记忆一致 → 跳过（不输出）
- 新信息与现有记忆矛盾或是对现有记忆的补充更新 → 输出 update（带现有记忆的 id，content 为合并后的完整表述）
- 新信息是新知识 → 输出 add
- 现有记忆被新信息明确推翻（如用户纠正了之前的说法）→ 输出 delete（带 id）
- 修改（update）时 content 必须是合并后的完整表述（不是差异）；类别与可信度按合并后的信息重新标注
- 相同主题的多条新候选可合并为一条

严格返回 JSON（不要任何其他文字）：
{"operations": [{"action": "add|update|delete", "id": 123（update/delete 必填）, "content": "最终记忆内容", "category": "fact|behavior|preference|experience", "confidence": 0.9}]}

没有需要执行的操作就返回 {"operations": []}。`

/** 单条消息长度截断（防超长对话撑爆抽取智能体） */
function clip(s: string, max = 4000): string {
  const t = String(s || '').trim()
  return t.length > max ? `${t.slice(0, max)}…(已截断)` : t
}

/**
 * 记忆抽取智能体：从一轮对话提取事实性记忆候选。
 * 返回空数组 = 没有值得记的。
 */
async function extractMemories(
  llm: any,
  userMessage: string,
  assistantMessage: string
): Promise<MemoryCandidate[]> {
  const prompt = `${EXTRACT_PROMPT}

=== 本轮对话 ===
【用户】
${clip(userMessage)}

【小助理】
${clip(assistantMessage)}`
  const resp = await llm.invoke(prompt)
  const text = typeof resp?.content === 'string' ? resp.content.trim() : ''
  const parsed = parseJsonLoose<{ memories: any[] }>(text)
  if (!parsed?.memories || !Array.isArray(parsed.memories)) {
    console.warn('[memory-pipeline] extract 输出无法解析为 JSON，原文前 300 字：', text.slice(0, 300) || '(空)')
    return []
  }
  const out: MemoryCandidate[] = []
  for (const m of parsed.memories) {
    const content = String(m?.content || '').trim()
    if (!content || content.length > 500) continue
    // 记忆统一为用户记忆（小助理对用户的了解），kind 固定 user
    const category = ['fact', 'behavior', 'preference', 'experience'].includes(m?.category) ? m.category : 'fact'
    const conf = Number(m?.confidence)
    out.push({
      kind: 'user',
      content,
      category,
      confidence: Number.isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 0.8
    })
  }
  return out
}

/** 记忆合成智能体：候选 + 相关旧记忆 → 增删改操作列表 */
async function synthesizeMemories(
  llm: any,
  candidates: MemoryCandidate[],
  related: { id: number; kind: string; content: string; category?: string | null; confidence?: number | null }[]
): Promise<SynthesizedMemory[]> {
  const prompt = `${SYNTHESIZE_PROMPT}

=== 新提取的记忆候选 ===
${JSON.stringify(candidates, null, 2)}

=== 相关现有记忆（top ${related.length}） ===
${related.length ? JSON.stringify(related, null, 2) : '（无）'}`
  const resp = await llm.invoke(prompt)
  const text = typeof resp?.content === 'string' ? resp.content.trim() : ''
  const parsed = parseJsonLoose<{ operations: any[] }>(text)
  if (!parsed?.operations || !Array.isArray(parsed.operations)) {
    console.warn('[memory-pipeline] synthesize 输出无法解析为 JSON，原文前 300 字：', text.slice(0, 300) || '(空)')
    return []
  }
  const out: SynthesizedMemory[] = []
  for (const op of parsed.operations) {
    const action = op?.action
    if (action !== 'add' && action !== 'update' && action !== 'delete') continue
    const id = Number(op?.id)
    if ((action === 'update' || action === 'delete') && !Number.isFinite(id)) continue
    const content = String(op?.content || '').trim()
    if (action !== 'delete' && (!content || content.length > 500)) continue
    // 记忆统一为用户记忆（小助理对用户的了解），kind 固定 user
    const category = ['fact', 'behavior', 'preference', 'experience'].includes(op?.category) ? op.category : 'fact'
    const conf = Number(op?.confidence)
    out.push({
      action,
      id: Number.isFinite(id) ? id : undefined,
      kind: 'user',
      content,
      category,
      confidence: Number.isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 0.8
    })
  }
  return out
}

/**
 * 记忆流水线入口：一轮对话结束后调用（异步、失败仅记日志不阻塞聊天）。
 * @param opts.onProgress 进度回调（推送 SSE 给前端：记忆正在更新/已完成）
 * @returns 实际执行的增删改数量（调试/日志用）
 */
export async function runMemoryPipeline(opts: {
  userId: number
  model: ModelConfig
  deps: MemoryStoreDeps
  sessionId: number
  userMessage: string
  assistantMessage: string
  onProgress?: (p: { status: 'running' | 'done' | 'skipped' | 'error'; detail?: string; runId: string }) => void
}): Promise<{ added: number; updated: number; deleted: number }> {
  const result = { added: 0, updated: 0, deleted: 0 }
  const runId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const log = (step: string, message: string) => pushLog(opts.userId, { runId, sessionId: opts.sessionId, step, message })
  const progress = (p: { status: 'running' | 'done' | 'skipped' | 'error'; detail?: string }) => {
    // 终态兜底日志：无论从哪条路径结束，都保证该 runId 有 done/error 终态条目
    // （前端日志轮询依赖终态条目判定结束，否则气泡永远显示「更新中」）
    if (p.status !== 'running') {
      const arr = logBuffer.get(opts.userId) || []
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
    // 前置检查：向量库 + 向量模型 + 对话模型可用
    if (!EmbeddingService.isReady(opts.deps.embedding)) {
      log('skip', '跳过：向量模型配置不完整')
      progress({ status: 'skipped', detail: '向量模型配置不完整' })
      return result
    }
    // buildFast：非流式 + 关思考，尽量提速
    const llm = LLMService.buildFast(opts.model, opts.userId, { temperature: 0 })
    if (!llm) {
      log('skip', '跳过：记忆模型配置不完整（apiKey/baseUrl 缺失）')
      progress({ status: 'skipped', detail: '记忆模型配置不完整' })
      return result
    }
    progress({ status: 'running' })

    // 1. 抽取智能体：从对话提取记忆候选
    log('extract', '正在提取本轮对话的记忆候选…')
    const t1 = Date.now()
    const candidates = await extractMemories(llm, opts.userMessage, opts.assistantMessage)
    log('extract', candidates.length
      ? `提取到 ${candidates.length} 条候选，耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`
      : `本轮对话没有值得记忆的内容，耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`)
    if (!candidates.length) {
      progress({ status: 'done', detail: '本轮对话没有需要记忆的内容' })
      return result
    }

    // 2. 相关性检索：候选拼接为查询，取 top10
    const query = candidates.map((c) => c.content).join('\n')
    const related = await searchMemories(opts.deps, query, 10).catch((e: any) => {
      log('search', `检索失败（按无相关记忆处理）：${e?.message || e}`)
      return []
    })
    log('search', `检索到 ${related.length} 条相关现有记忆`)
    if (related.length) {
      log('search', related.map((r) => `#${r.id} ${clip(r.content, 30)}`).join('；'))
    }

    // 3. 合成智能体：生成最终操作列表
    log('synthesize', `正在合成最终记忆操作（${candidates.length} 条候选 × ${related.length} 条相关）…`)
    const t3 = Date.now()
    const operations = await synthesizeMemories(
      llm,
      candidates,
      related.map((r) => ({ id: r.id, kind: r.kind, content: r.content, category: r.category, confidence: r.confidence }))
    )
    if (operations.length) {
      log('synthesize', `生成 ${operations.length} 个操作，耗时 ${((Date.now() - t3) / 1000).toFixed(1)}s：${operations.map((o) => `${o.action}${o.id ? '#' + o.id : ''}「${clip(o.content, 24)}」`).join('；')}`)
    } else {
      log('synthesize', `无需执行任何操作（候选与现有记忆一致），耗时 ${((Date.now() - t3) / 1000).toFixed(1)}s`)
      progress({ status: 'done', detail: '记忆无变化' })
      return result
    }

    // 4. 执行增删改
    for (const op of operations) {
      try {
        if (op.action === 'delete' && op.id != null) {
          const ok = await deleteMemory(opts.deps, op.kind, op.id)
          if (ok) {
            result.deleted++
            log('done', `已删除记忆 #${op.id}`)
          } else {
            log('done', `删除 #${op.id} 未命中（记忆不存在或归属不符）`)
          }
        } else if (op.action === 'update' && op.id != null) {
          const row = await updateMemory(opts.deps, op.kind, op.id, {
            content: op.content,
            category: op.category,
            confidence: op.confidence
          })
          if (row) {
            result.updated++
            log('done', `已更新记忆 #${op.id}：「${clip(op.content, 30)}」`)
          } else {
            log('done', `更新 #${op.id} 未命中（记忆不存在或归属不符）`)
          }
        } else if (op.action === 'add') {
          await insertMemory(opts.deps, op.kind, {
            content: op.content,
            category: op.category,
            confidence: op.confidence,
            sourceSession: opts.sessionId
          })
          result.added++
          log('done', `已新增记忆：「${clip(op.content, 30)}」`)
        }
      } catch (e: any) {
        log('error', `执行单条失败 ${op.action}${op.id ? '#' + op.id : ''}「${clip(op.content, 20)}」：${e?.message || e}`)
      }
    }
    log('done', `完成：新增 ${result.added}、更新 ${result.updated}、删除 ${result.deleted}（总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
    const parts: string[] = []
    if (result.added) parts.push(`新增 ${result.added} 条`)
    if (result.updated) parts.push(`更新 ${result.updated} 条`)
    if (result.deleted) parts.push(`删除 ${result.deleted} 条`)
    progress({ status: 'done', detail: parts.join('、') || '记忆无变化' })
  } catch (e: any) {
    log('error', `流水线失败：${e?.message || e}`)
    progress({ status: 'error', detail: e?.message || '记忆更新失败' })
  }
  return result
}
