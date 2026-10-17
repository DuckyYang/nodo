/**
 * 基于 LangChain DeepAgents 框架的智能体编排（deepagents 1.15.0）。
 *
 * 架构（对照官方文档 https://docs.langchain.com/oss/javascript/deepagents/overview）：
 * 1. createDeepAgent 构建 harness：内置文件工具
 *    （write_file / read_file / ls / edit_file / glob / grep）
 *    + task 子代理委派 + write_todos（todoListMiddleware，1.15.0 起 opt-in）
 * 2. 文件后端用 FilesystemBackend（virtualMode）直连真实磁盘：
 *    root 为用户工作目录（笔记根），/AI笔记/ 等笔记目录与
 *    /app_work_space/{会话ID}/upload|output/（附件与生成物）对智能体
 *    均可见——写即落盘、读附件零拷贝；virtualMode 的 resolvePath
 *    强制路径封禁在工作目录内（拒绝 ..、~、越界），天然沙箱，
 *    无需状态缓存与落盘同步。backend 自动传给主 agent、子代理与
 *    summarization middleware，全运行共享同一实例
 * 3. 对话历史按 DB 归档由调用方传入（外层自管理，不用 checkpointer）；
 *    但 HITL 中断-恢复运行在 MemorySaver（内存 checkpointer，按会话
 *    thread_id 隔离）上——interrupt 时图状态挂起，resume 从断点继续
 * 4. 自定义域工具（联网检索 / 待办管理）用 DynamicStructuredTool + zod/v3 schema
 * 5. 流式：v3 协议的类型化投影 —— run.messages（.text/.reasoning/.usage）、
 *    run.toolCalls（.input/.output/.status，callId 即 tool_call_id）、
 *    run.subagents（递归消费，含子代理自己的 messages/toolCalls）。
 *    思考内容由 @langchain/openai 原生流式路径产出 reasoning-delta
 *    （delta.reasoning_content ?? delta.reasoning），无需自定义 ChatModel。
 */
import { createDeepAgent, FilesystemBackend, type DeepAgentRunStream } from 'deepagents'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { todoListMiddleware, humanInTheLoopMiddleware } from 'langchain'
import { Command, MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph'
import path from 'node:path'
import { LLMService } from './LLMService'
import { TavilyService } from './TavilyService'
import { NotesSafeFs } from './NotesSafeFs'
import { TodoTools } from './TodoTools'
import { resolveCheckpointer } from './PostgresCheckpointer'
import type { ModelConfig, BochaConfig, WeChatConfig, PostgresConfig, EmbeddingConfig } from '../entities/UserConfig'

export interface DeepAgentRunContext {
  userId: number
  /** 用户显示名（系统提示词身份注入用） */
  userName?: string
  message: string
  /** 当前会话 ID（附件/生成物目录定位） */
  sessionId: number
  /** 本轮用户消息附带的上传文件 */
  attachments: { name: string; relPath: string; size: number }[]
  /** 用户在本轮激活的技能目录名（agent-skills 下），动态挂载对应技能 */
  activeSkills?: string[]
  /** 本轮是否挂载联网检索工具（前端发送区开关） */
  webSearchEnabled?: boolean
  /** 本轮是否挂载知识库工具（前端发送区开关；knowledge_search + save_knowledge） */
  knowledgeEnabled?: boolean
  /** 检索到的相关记忆（注入系统提示词；空/未定义 = 会话未开启记忆或无相关记忆） */
  memoryContext?: string
  /** 运行标识（用户+会话），用于中止 */
  threadKey: string
  /** DB 会话归档的历史（含本轮用户消息） */
  history: { role: 'user' | 'assistant'; content: string }[]
  secrets: {
    model: ModelConfig
    bocha: BochaConfig
    wechat: WeChatConfig
    /** PostgreSQL（HITL checkpointer 持久化；未配置则回退内存版） */
    postgres?: PostgresConfig
    workDir: string | null
    /** 记忆/知识库依赖（pg + 向量模型） */
    embedding?: EmbeddingConfig
    /** 记忆流水线模型 */
    memoryModel?: ModelConfig | null
    /** 知识库切片模型 */
    knowledgeModel?: ModelConfig | null
  }
  onToken: (token: string) => void
  onThought: (token: string) => void
  onTool: (info: { tool: string; input?: any; output?: any; runId?: string }) => void
  /**
   * HITL 确认请求：delete_todo / delete_todo_group 等破坏性工具触发
   * interrupt 后调用。返回 Promise<'approve' | 'reject' | 'ignore'>：
   * - approve：同意执行（resume approve）
   * - reject：拒绝执行，模型收到拒绝原因（resume reject）
   * - ignore：忽略本次请求（直接终止运行，不 resume）
   */
  onHitl: (task: { tool: string; input: any; prompt: string }) => Promise<'approve' | 'reject' | 'ignore'> | 'approve' | 'reject' | 'ignore'
  /** AI 回复归档（含 thought/tools/timeline/usage），供会话落库 */
  onReply: (msg: { role: 'assistant'; content: string; thought?: string; tools?: { tool: string; input?: any; output?: any }[]; timeline?: { type: 'reasoning' | 'content' | 'tool'; text?: string; tool?: string; input?: any; output?: any }[]; usage?: { input: number; output: number } }) => void
  onDone: () => void
  onError: (e: Error) => void
}

/** timeline 段类型（归档 DB + 前端渲染契约） */
interface TlSeg {
  type: 'reasoning' | 'content' | 'tool'
  text?: string
  tool?: string
  input?: any
  output?: any
  running?: boolean
  runId?: string
}

/** 进行中的运行（用于中止） */
const activeRuns = new Map<string, AbortController>()

/**
 * HITL 会话级内存 checkpointer（未配置 PostgreSQL 时的兜底）：
 * interrupt 后图状态挂起在内存，用户选择后用 Command({ resume })
 * 续跑同一 thread_id。key = threadKey（用户+会话），运行结束清理。
 * 配置了 PostgreSQL 时走 PostgresCheckpointer（跨重启持久化）
 */
const hitlCheckpointers = new Map<string, MemorySaver>()

/** 清理某会话的内存 checkpointer（对话正常结束 / 停止时调用；Postgres 版持久化无需清理） */
export function cleanupHitlThread(threadKey: string) {
  hitlCheckpointers.delete(threadKey)
}

/** 中止指定运行 */
export function abortRun(threadKey: string) {
  const ctrl = activeRuns.get(threadKey)
  if (ctrl) {
    ctrl.abort()
    activeRuns.delete(threadKey)
  }
  cleanupHitlThread(threadKey)
}

const SYSTEM_PROMPT = `你是用户的小助理。你可以：
1. 与用户日常交流
{webSearchItem}{knowledgeItem}3. 使用待办工具管理用户的待办与分组：
   add_todo（新增，支持备注/负责人/计划时间/置顶/提醒）、
   query_todos（查询，支持按分组/完成状态/今日/逾期/未分组过滤
   和关键词搜索）、update_todo（更新）、delete_todo（删除）、
   list_todo_groups（查分组）、create_todo_group（建分组）、
   update_todo_group（改分组）、delete_todo_group（删分组，组内
   待办移到未分组）。操作待办分组前先 list_todo_groups
   确认分组 ID
4. 用户上传的附件存放在 /app_work_space/{会话ID}/upload/ 目录下，
   用 ls 查看文件列表，用 read_file 读取文本内容（支持分页）；
   PDF/DOCX 等富文本格式用 extract_file_text 工具提取内容
5. 需要生成文件（如代码产物、转换结果、导出数据）时，一律用
   write_file 写入 /app_work_space/{会话ID}/output/ 目录，
   不要写到其他位置
6. 用户的工作目录就是你的根目录 /，笔记存放在其中的目录里
   （如 /AI笔记/）。需要查找、读取、整理用户的笔记文件时，
   用 ls / 查看目录结构，用 grep/glob 搜索定位文件；
   修改或删除用户的笔记文件前，先向用户说明将要做什么
7. 需要为用户产出正式笔记时，使用 save_note 工具（写入
   /AI笔记/ 目录，用户可在笔记模块直接查看）
回答简洁、准确。复杂任务先用 write_todos 规划步骤。`

/** web_search 每轮硬限制次数 */
const WEB_SEARCH_LIMIT = 10

/** 按会话实例化系统提示词（注入当前会话的 upload/output 路径与附件清单） */
function buildSystemPrompt(ctx: DeepAgentRunContext): string {
  // 联网检索关闭时剔除提示词中的 web_search 条目（模型不感知该能力）
  const webSearchItem = ctx.webSearchEnabled === false ? '' : `2. 使用 web_search 工具联网检索（每轮对话最多调用 10 次，
   请规划好关键词、合并同类查询，避免重复检索）
`
  // 知识库开关开启时注入知识工具条目（关闭时模型不感知）
  const knowledgeItem = ctx.knowledgeEnabled === true ? `2.5. 使用知识库工具：
   - knowledge_search：语义检索用户知识库（上传文档的切片、以往对话
     沉淀的知识）
   - save_knowledge：把本轮对话中的有价值知识保存到用户知识库，
     供以后检索复用；内容保持原文，不要压缩改写（注意：对话结束
     后系统会自动提取事实性知识入库，只有用户明确要求保存、或想
     主动整理大段内容时才需要调用本工具，避免重复入库）

   【检索优先级（必须严格遵守）】知识库永远优先于联网检索：
   a. 回答任何可能涉及已有知识、事实、资料的问题时，第一步必须
      先调用 knowledge_search 检索知识库
   b. 知识库命中且内容足以回答 → 直接引用知识库内容回答，
      不要再联网检索
   c. 知识库未命中、命中不足或内容过时 → 再用 web_search 联网
      检索补充
` : ''
  let prompt = SYSTEM_PROMPT.replace(/\{会话ID\}/g, String(ctx.sessionId)).replace(/\{webSearchItem\}/, webSearchItem).replace(/\{knowledgeItem\}/, knowledgeItem)
  // 上下文注入：当前日期星期 + 用户身份（让模型知道时间与用户是谁）
  const now = new Date()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（星期${weekdays[now.getDay()]}）`
  prompt += `\n\n当前时间：${dateStr} ${now.toTimeString().slice(0, 8)}\n用户：${ctx.userName || '（未设置姓名）'}（用户ID: ${ctx.userId}）`
  // 长期记忆注入：对话开始前按相关性检索的用户画像记忆
  if (ctx.memoryContext) {
    prompt += `\n\n以下是长期记忆（你对该用户的了解，与本次对话相关的部分；供参考，不是本次对话内容）。每条记忆标注了记录时间与可信度：可信度随时间衰减，时间越久远的记忆可靠性越低。使用原则：
- 可信度高（≥0.7）的记忆可以放心作为背景参考
- 可信度中等（0.4~0.7）的记忆谨慎参考，不要作为唯一依据
- 可信度低（<0.4，久远或当时就不确定的记忆）不要盲目相信：涉及关键决策时先和用户确认（如「我记得你之前提到过…现在还是这样吗？」），或以本次对话中用户的最新表述为准
- 本轮对话中用户说的话永远优先于记忆
${ctx.memoryContext}`
  }
  if (ctx.attachments?.length) {
    prompt += `\n\n本次用户上传的附件（位于 /app_work_space/${ctx.sessionId}/upload/ 下，可直接用 read_file 读取）：
${ctx.attachments.map((a) => `- /app_work_space/${ctx.sessionId}/upload/${path.basename(a.relPath)}（${a.name}，${a.size} 字节）`).join('\n')}`
  }
  return prompt
}

/**
 * 规范工具输入：v3 的 ToolCallStream.input 已是解析后的对象，但个别
 * 中间层（zod preprocess 等）可能残留双层包装 {input: "JSON"}，
 * 统一解包为真实参数对象，便于前端提取与落盘逻辑使用。
 */
export function normalizeToolInput(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw
  if ('input' in raw && Object.keys(raw).length <= 2) {
    const inner = raw.input
    if (typeof inner === 'string') {
      try {
        const parsed = JSON.parse(inner)
        if (parsed && typeof parsed === 'object') return parsed
      } catch { /* 不是 JSON 就原样返回 */ }
    } else if (inner && typeof inner === 'object') {
      return inner
    }
  }
  return raw
}

/** 构建域工具（联网检索 + 待办管理 + 笔记落盘包装） */
function buildTools(ctx: DeepAgentRunContext, safeFs: NotesSafeFs, tavily: TavilyService, todoTools: TodoTools) {
  // web_search 每轮硬限制：超过 WEB_SEARCH_LIMIT 次直接报错（配合提示词软限制）
  let searchCount = 0
  const webSearch = new DynamicStructuredTool({
    name: 'web_search',
    description: '联网检索：根据关键词搜索互联网内容，返回摘要与链接。',
    schema: z.object({ query: z.string().describe('搜索关键词') }),
    func: async (input) => {
      searchCount++
      if (searchCount > WEB_SEARCH_LIMIT) {
        return JSON.stringify({
          error: `本轮对话 web_search 调用次数已达上限（${WEB_SEARCH_LIMIT} 次），请基于已检索到的信息回答，或建议用户开启新对话。`
        })
      }
      const out = await tavily.search(input.query)
      return JSON.stringify(out)
    }
  })

  const addTodo = new DynamicStructuredTool({
    name: 'add_todo',
    description: '新增待办事项。',
    schema: z.object({
      content: z.string().describe('待办内容'),
      groupId: z.number().nullish().describe('分组 ID（可用 list_todo_groups 查询；默认分组/未分组 = 不传或传 null）'),
      remark: z.string().optional().describe('备注'),
      owner: z.string().optional().describe('负责人'),
      planStart: z.string().optional().describe('计划开始时间 ISO'),
      planEnd: z.string().optional().describe('计划结束时间 ISO'),
      pinned: z.boolean().optional().describe('是否置顶'),
      remindEnabled: z.boolean().optional().describe('是否开启提醒'),
      startBeforeMinutes: z.number().optional().describe('开始提醒：计划开始前 x 分钟（≥3）'),
      endBeforeMinutes: z.number().optional().describe('结束提醒：计划完成前 x 分钟（≥3）'),
      repeatEnabled: z.boolean().optional().describe('重复提醒：提醒窗口内每隔 y 分钟再提醒'),
      repeatIntervalMinutes: z.number().optional().describe('重复间隔 y 分钟（1 ≤ y ≤ x）'),
      status: z.enum(['not_started', 'in_progress', 'completed']).optional().describe('状态：未开始/进行中/已完成')
    }),
    func: async (input) => {
      // 提醒参数规整为 remindRule（与前端提交结构一致）
      const { startBeforeMinutes, endBeforeMinutes, repeatEnabled, repeatIntervalMinutes, ...rest } = input
      const rule = input.remindEnabled
        ? {
            startBeforeMinutes,
            endBeforeMinutes,
            repeatEnabled: !!repeatEnabled,
            repeatIntervalMinutes: repeatEnabled ? repeatIntervalMinutes : undefined
          }
        : undefined
      const t = await todoTools.add({ ...rest, remindRule: rule })
      return JSON.stringify({ ok: true, id: t.id })
    }
  })

  const queryTodos = new DynamicStructuredTool({
    name: 'query_todos',
    description: '查询当前用户的待办列表。可按分组、完成状态、时间维度（今日/逾期/未分组）过滤，支持关键词匹配内容与备注。不传参数则返回全部（最多 50 条）。',
    schema: z.object({
      groupId: z.number().nullish().describe('分组 ID（null = 默认分组/未分组；不传 = 不过滤分组）'),
      done: z.boolean().optional().describe('完成状态'),
      filter: z.enum(['uncompleted', 'today', 'overdue', 'ungrouped']).optional().describe('时间维度过滤：未完成/今日计划/已逾期/未分组'),
      keyword: z.string().optional().describe('关键词，匹配待办内容或备注')
    }),
    func: async (input) => {
      const list = await todoTools.query(input)
      // 精简返回：去重字段，保留模型需要的上下文
      const slim = list.slice(0, 50).map((t) => ({
        id: t.id, content: t.content, done: t.done, status: t.status || (t.done ? 'completed' : 'not_started'), groupId: t.groupId ?? null,
        remark: t.remark || undefined, owner: t.owner || undefined,
        planStart: t.planStart || undefined, planEnd: t.planEnd || undefined,
        pinned: t.pinned, shelved: t.shelved
      }))
      return JSON.stringify({ total: list.length, list: slim })
    }
  })

  const updateTodo = new DynamicStructuredTool({
    name: 'update_todo',
    description: '更新待办（内容/备注/完成状态/负责人/分组/计划时间/置顶/搁置等）。',
    schema: z.object({
      id: z.number(),
      content: z.string().optional(),
      remark: z.string().optional().describe('备注'),
      done: z.boolean().optional().describe('完成状态（切换时自动记录/清除完成时间）'),
      status: z.enum(['not_started', 'in_progress', 'completed']).optional().describe('状态：未开始/进行中/已完成（与 done 等价联动，completed=done true）'),
      groupId: z.number().nullish().describe('分组 ID（null 表示移出到默认分组/未分组）'),
      owner: z.string().optional().describe('负责人'),
      pinned: z.boolean().optional().describe('是否置顶'),
      shelved: z.boolean().optional().describe('是否搁置'),
      planStart: z.string().optional().describe('计划开始时间 ISO'),
      planEnd: z.string().optional().describe('计划结束时间 ISO'),
      remindEnabled: z.boolean().optional().describe('是否开启提醒'),
      startBeforeMinutes: z.number().optional().describe('开始提醒：计划开始前 x 分钟（≥3）'),
      endBeforeMinutes: z.number().optional().describe('结束提醒：计划完成前 x 分钟（≥3）'),
      repeatEnabled: z.boolean().optional().describe('重复提醒：提醒窗口内每隔 y 分钟再提醒'),
      repeatIntervalMinutes: z.number().optional().describe('重复间隔 y 分钟（1 ≤ y ≤ x）')
    }),
    func: async (input) => {
      const { id, startBeforeMinutes, endBeforeMinutes, repeatEnabled, repeatIntervalMinutes, remindEnabled, ...patch } = input
      // planStart/planEnd 是 ISO 字符串，转 Date 后入库
      const norm: Record<string, any> = {}
      for (const [k, v] of Object.entries(patch)) {
        if ((k === 'planStart' || k === 'planEnd') && typeof v === 'string') norm[k] = new Date(v)
        else norm[k] = v
      }
      // 提醒参数规整为 remindRule（任一提醒参数出现即整体覆盖规则，与前端提交结构一致）
      if (remindEnabled !== undefined || startBeforeMinutes !== undefined || endBeforeMinutes !== undefined || repeatEnabled !== undefined) {
        norm.remindEnabled = remindEnabled !== false
        norm.remindRule = remindEnabled === false
          ? null
          : { startBeforeMinutes, endBeforeMinutes, repeatEnabled: !!repeatEnabled, repeatIntervalMinutes: repeatEnabled ? repeatIntervalMinutes : undefined }
      }
      const t = await todoTools.update(id, norm)
      return JSON.stringify({ ok: true, id: t.id })
    }
  })

  const deleteTodo = new DynamicStructuredTool({
    name: 'delete_todo',
    description: '删除待办（破坏性操作，执行前需要用户确认）。',
    schema: z.object({
      id: z.number(),
      confirm_desc: z.string().describe('给用户看的删除内容说明（自然语言）：要删除哪些待办、内容是什么。先查待办，再如实列出，禁止编造。例如：即将删除待办「买牛奶」；批量删除时逐条列出，如：默认分组内有 3 条待办：「买牛奶」「写周报」「回邮件」，是否全部删除？')
    }),
    func: async (input) => {
      await todoTools.del(input.id)
      return JSON.stringify({ ok: true, id: input.id })
    }
  })

  // ============== 待办分组工具 ==============

  const listTodoGroups = new DynamicStructuredTool({
    name: 'list_todo_groups',
    description: '查询当前用户的待办分组列表（id/名称/置顶/排序）。',
    schema: z.object({}),
    func: async () => {
      const list = await todoTools.listGroups()
      return JSON.stringify(list.map((g) => ({ id: g.id, name: g.name, pinned: g.pinned, sort: g.sort })))
    }
  })

  const createTodoGroup = new DynamicStructuredTool({
    name: 'create_todo_group',
    description: '新建待办分组。',
    schema: z.object({
      name: z.string().describe('分组名称'),
      pinned: z.boolean().optional().describe('是否置顶')
    }),
    func: async (input) => {
      const g = await todoTools.createGroup({ name: input.name })
      if (input.pinned) await todoTools.updateGroup(g.id, { pinned: true })
      return JSON.stringify({ ok: true, id: g.id, name: g.name })
    }
  })

  const updateTodoGroup = new DynamicStructuredTool({
    name: 'update_todo_group',
    description: '更新待办分组（重命名/置顶）。',
    schema: z.object({
      id: z.number(),
      name: z.string().optional().describe('新名称'),
      pinned: z.boolean().optional().describe('是否置顶')
    }),
    func: async (input) => {
      const { id, ...patch } = input
      const g = await todoTools.updateGroup(id, patch)
      return JSON.stringify({ ok: true, id: g.id, name: g.name })
    }
  })

  const deleteTodoGroup = new DynamicStructuredTool({
    name: 'delete_todo_group',
    description: '删除待办分组（组内待办移到未分组，不会删除待办本身；破坏性操作，执行前需要用户确认）。',
    schema: z.object({
      id: z.number(),
      confirm_desc: z.string().describe('给用户看的删除说明（自然语言）：分组名与影响。例如：即将删除分组「工作」（组内待办移到默认分组），是否继续？')
    }),
    func: async (input) => {
      await todoTools.deleteGroup(input.id)
      return JSON.stringify({ ok: true, id: input.id })
    }
  })

  // 文件文本提取：解析 PDF/DOCX 等富文本（纯文本文件直接用内置 read_file 即可）
  const extractFileText = new DynamicStructuredTool({
    name: 'extract_file_text',
    description: '提取文件的文本内容。支持 txt/md/json/csv/xml/html/代码文件/pdf/docx/xlsx/pptx。路径为根目录（用户工作目录）下的绝对路径，例如 /AI笔记/报告.pdf 或 /app_work_space/12/upload/report.pdf。',
    schema: z.object({
      file_path: z.string().describe('文件路径（以 / 开头），例如 /AI笔记/测试.xlsx')
    }),
    func: async (input) => {
      if (!ctx.secrets.workDir) return JSON.stringify({ error: '工作目录未设置' })
      try {
        // 工作目录（backend 根）内的虚拟路径 → 真实绝对路径
        const abs = path.resolve(ctx.secrets.workDir, input.file_path.replace(/^\//, ''))
        const rel = path.relative(ctx.secrets.workDir, abs)
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return JSON.stringify({ error: '禁止访问工作目录之外的路径' })
        }
        const { extractText } = await import('./FileTextExtractor')
        const text = await extractText(abs)
        return text || '(文件无文本内容)'
      } catch (e: any) {
        return JSON.stringify({ error: e.message || '文件解析失败' })
      }
    }
  })

  // 生成笔记：写入工作目录的 AI笔记 目录（用户可在笔记模块查看）
  const saveNote = new DynamicStructuredTool({
    name: 'save_note',
    description: '把内容保存为一篇正式笔记，写入工作目录的 AI笔记 目录（markdown）。用户需要沉淀知识、总结整理、生成文档时使用。',
    schema: z.object({
      filename: z.string().describe('笔记文件名（不含目录，可带 .md 后缀）'),
      content: z.string().describe('笔记正文（markdown）')
    }),
    func: async (input) => {
      if (!ctx.secrets.workDir) return JSON.stringify({ error: '工作目录未设置' })
      try {
        const pathMod = await import('node:path')
        // 文件名净化：仅取 basename + 过滤非法字符；默认补 .md 后缀
        let fname = pathMod.basename(input.filename).replace(/[\\/:*?"<>|]/g, '_').trim()
        if (!fname) return JSON.stringify({ error: '文件名不能为空' })
        if (!/\.[a-z0-9]+$/i.test(fname)) fname += '.md'
        const rel = `AI笔记/${fname}`
        await safeFs.writeFile(rel, input.content)
        return JSON.stringify({ ok: true, path: rel, size: input.content.length })
      } catch (e: any) {
        return JSON.stringify({ error: e.message || '笔记保存失败' })
      }
    }
  })

  // 知识库检索：用户开启知识库开关时挂载（向量检索用户的知识片段）
  const knowledgeSearch = new DynamicStructuredTool({
    name: 'knowledge_search',
    description: '检索用户知识库：向量语义检索用户保存的知识片段（上传文档的切片、对话沉淀的知识）。回答任何可能涉及已有知识、事实、资料的问题时，必须先用本工具检索（优先级高于 web_search 联网检索），命中则直接引用知识库内容回答。',
    schema: z.object({
      query: z.string().describe('检索问题或关键词'),
      top_k: z.number().optional().describe('返回条数（默认 5，最大 10）')
    }),
    func: async (input) => {
      if (!ctx.secrets.postgres || !ctx.secrets.embedding) {
        return JSON.stringify({ error: '知识库未配置（需 PostgreSQL + 向量模型）' })
      }
      try {
        const { searchKnowledge } = await import('./KnowledgeStore')
        const hits = await searchKnowledge(
          { userId: ctx.userId, pg: ctx.secrets.postgres, embedding: ctx.secrets.embedding },
          input.query,
          Math.min(input.top_k || 5, 10)
        )
        return JSON.stringify({
          total: hits.length,
          results: hits.map((h) => ({ docId: h.docId, title: h.docTitle, source: h.source, seq: h.seq, score: Number(h.score.toFixed(3)), content: h.content }))
        })
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || '知识检索失败' })
      }
    }
  })

  // 知识入库：把对话中产生的有价值知识保存到知识库（一条记录 + 模型切片 + 向量化）
  const saveKnowledge = new DynamicStructuredTool({
    name: 'save_knowledge',
    description: '把用户明确要求保存的知识、或整理好的大段内容保存到用户知识库（供以后检索复用）。注意：对话结束后系统会自动提取事实性知识入库，本工具仅在用户明确要求保存时使用，避免重复入库。内容较长会自动切片向量化。',
    schema: z.object({
      title: z.string().describe('知识标题（简短概括）'),
      content: z.string().describe('知识完整内容（保持原文，不要总结压缩）'),
      reason: z.string().optional().describe('保存原因（给用户看的说明）')
    }),
    func: async (input) => {
      if (!ctx.secrets.postgres || !ctx.secrets.embedding) {
        return JSON.stringify({ error: '知识库未配置（需 PostgreSQL + 向量模型）' })
      }
      try {
        const { processKnowledgeFromChat } = await import('./KnowledgePipeline')
        const r = await processKnowledgeFromChat(
          { userId: ctx.userId, pg: ctx.secrets.postgres, embedding: ctx.secrets.embedding },
          ctx.secrets.knowledgeModel || ctx.secrets.memoryModel || ctx.secrets.model,
          input.title,
          input.content,
          ctx.sessionId
        )
        return JSON.stringify({ ok: true, docId: r.docId, chunkCount: r.chunkCount, message: `已保存 ${r.chunkCount} 个切片` })
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || '知识保存失败' })
      }
    }
  })

  return { webSearch, addTodo, queryTodos, updateTodo, deleteTodo, listTodoGroups, createTodoGroup, updateTodoGroup, deleteTodoGroup, extractFileText, saveNote, knowledgeSearch, saveKnowledge }
}

/**
 * 运行 DeepAgent：SSE 逐 token / thought / tool 推送。
 *
 * v3 流式投影的消费策略：
 * - run.messages（主 agent 的模型消息）：.reasoning → thought 通道；
 *   .text → token 通道；.usage 完成后累加 token 统计
 * - run.toolCalls（主 agent 的工具调用）：start 即推送（input），output
 *   Promise 完成后回填（callId 即前端回填用的 runId）
 * - run.subagents：递归消费子代理的 messages/toolCalls（timeline 并入，
 *   前端无感知区分）
 * 三个投影并发消费（Promise.all），共享同一份 timeline / finalTools 收集器。
 */
export async function runDeepAgent(ctx: DeepAgentRunContext) {
  const llm = LLMService.build(ctx.secrets.model, ctx.userId)
  if (!llm) {
    ctx.onError(new Error('模型未配置或无法初始化'))
    return
  }

  const safeFs = new NotesSafeFs(ctx.secrets.workDir)
  const tavily = new TavilyService(ctx.secrets.bocha)
  const todoTools = new TodoTools(ctx.userId)
  const { webSearch, addTodo, queryTodos, updateTodo, deleteTodo, listTodoGroups, createTodoGroup, updateTodoGroup, deleteTodoGroup, extractFileText, saveNote, knowledgeSearch, saveKnowledge } = buildTools(ctx, safeFs, tavily, todoTools)

  // 工具组装：联网检索开关关闭时不挂 web_search（系统提示词同步剔除
  // 相关条目，模型不感知联网能力）；researcher 子代理同样不挂载
  // 知识库开关开启时挂 knowledge_search / save_knowledge
  const webSearchOn = ctx.webSearchEnabled !== false
  const knowledgeOn = ctx.knowledgeEnabled === true
  const baseTools = [addTodo, queryTodos, updateTodo, deleteTodo, listTodoGroups, createTodoGroup, updateTodoGroup, deleteTodoGroup, extractFileText, saveNote]
  let agentTools: any[] = webSearchOn ? [webSearch, ...baseTools] : [...baseTools]
  if (knowledgeOn) agentTools = [...agentTools, knowledgeSearch, saveKnowledge]

  // 注册运行（可中止）+ 客户端已断开时立即退出
  const ctrl = new AbortController()
  activeRuns.set(ctx.threadKey, ctrl)
  const aborted = () => ctrl.signal.aborted

  // 文件后端：直连真实磁盘，root 为用户工作目录（笔记根）
  // 工作目录下：/AI笔记/ 与用户自建目录是笔记模块可见内容；
  // /app_work_space/{会话ID}/upload/ 存用户附件、output/ 存智能体生成物
  // （隐藏目录，均已预创建）。virtualMode 把模型可见路径封禁在
  // 工作目录内（拒绝 ..、~、越界访问），笔记与附件对智能体均可见
  let backend: FilesystemBackend | null = null
  if (ctx.secrets.workDir) {
    try {
      const { ensureSessionUploadDir, ensureSessionOutputDir } = await import('./WorkspaceFs')
      await ensureSessionUploadDir(ctx.secrets.workDir, ctx.sessionId)
      await ensureSessionOutputDir(ctx.secrets.workDir, ctx.sessionId)
      backend = new FilesystemBackend({ rootDir: ctx.secrets.workDir, virtualMode: true })
    } catch {
      // 目录创建失败时退化为默认 StateBackend（内存虚拟 FS）
    }
  }

  // 技能动态挂载：用户本轮激活的技能（/agent-skills/{dir}/ 直达路径）。
  // 未激活则不传 skills，SkillsMiddleware 不注入任何技能上下文
  const activeSkillSources = (ctx.activeSkills || [])
    .filter((d) => d && !d.includes('..') && !/[\\/:*?"<>|]/.test(d))
    .map((d) => `/agent-skills/${d}/`)
    .slice(0, 20)

  // HITL checkpointer：配置了 PostgreSQL（配置中心）时用 PostgresSaver
  // 持久化（中断跨应用重启存活）；否则内存版兜底。Postgres 版按用户
  // 共享连接池（线程一次性 ID 隔离状态），连接失败自动降级内存版
  const pgSaver = await resolveCheckpointer(ctx.userId, ctx.secrets.postgres).catch(() => null)
  let checkpointer: BaseCheckpointSaver
  if (pgSaver) {
    checkpointer = pgSaver
  } else {
    checkpointer = hitlCheckpointers.get(ctx.threadKey) || new MemorySaver()
    hitlCheckpointers.set(ctx.threadKey, checkpointer as MemorySaver)
  }

  // LangGraph thread：每轮运行一次性 ID（PostgresSaver 状态只服务本轮的
  // HITL 中断-恢复；历史由 DB 全量注入，跨轮复用同一线程会导致消息重复）。
  // 运行结束 deleteThread 清理持久化状态，避免表膨胀
  const threadId = `${ctx.threadKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  try {
    // DeepAgents 官方入口：createDeepAgent
    // 内置文件工具（write_file/read_file/ls/edit_file/glob/grep）由 backend
    // 驱动直连磁盘；backend 自动传给主 agent、子代理与 summarization
    // middleware。write_todos 由 todoListMiddleware 注入；
    // custom subagent 需显式传 tools。
    // HITL：delete_todo / delete_todo_group 强制 interrupt（模型不可绕过），
    // checkpointer 持久化挂起状态供 Command({ resume }) 断点续跑
    const agent = createDeepAgent({
      model: llm,
      tools: agentTools,
      systemPrompt: buildSystemPrompt(ctx),
      middleware: [
        todoListMiddleware(),
        humanInTheLoopMiddleware({
          interruptOn: {
            delete_todo: {
              allowedDecisions: ['approve', 'reject'],
              // 确认文案：模型在 confirm_desc 参数里生成的自然语言说明
              description: (toolCall) => String(toolCall.args?.confirm_desc || `待办删除确认（ID: ${toolCall.args?.id}）`)
            },
            delete_todo_group: {
              allowedDecisions: ['approve', 'reject'],
              description: (toolCall) => String(toolCall.args?.confirm_desc || `待办分组删除确认（ID: ${toolCall.args?.id}，组内待办会移到未分组）`)
            }
          }
        })
      ],
      checkpointer,
      ...(backend ? { backend } : {}),
      // 动态技能挂载：仅用户激活的技能（backend 相对直达路径）
      ...(backend && activeSkillSources.length ? { skills: activeSkillSources } : {}),
      // 联网检索开启时才提供调研子代理（依赖 web_search）
      ...(webSearchOn
        ? {
            subagents: [
              {
                name: 'researcher',
                description: '需要联网收集资料、检索多轮搜索结果的调研子任务',
                systemPrompt: '你是调研助理。使用 web_search 收集信息，汇总为要点后返回。',
                tools: [webSearch]
              }
            ]
          }
        : {})
    })

    // 恢复会话历史（DB 归档）；文件状态由 backend 直连磁盘持久化，无需注入
    const historyMessages = (ctx.history || []).map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
    )
    // LangGraph thread：一次性 ID（threadId 已在 try 外生成，供 finally 清理）
    const lgConfig = { version: 'v3' as const, signal: ctrl.signal, configurable: { thread_id: threadId } }

    let finalContent = ''
    let finalThought = ''
    const finalTools: { tool: string; input?: any; output?: any }[] = []
    // 事件流时间线：按实际发生顺序记录 reasoning / content / tool 段
    const timeline: TlSeg[] = []
    // token 消耗统计：累加每次模型调用的 usage（含工具循环的多轮调用）
    let usageIn = 0
    let usageOut = 0

    /** timeline：reasoning/content 追加到末尾同类型段（或新起一段） */
    const pushText = (type: 'reasoning' | 'content', text: string) => {
      const last = timeline[timeline.length - 1]
      if (last && last.type === type) last.text = (last.text || '') + text
      else timeline.push({ type, text })
    }

    /** 消费一条模型消息流（.reasoning/.text/.usage 投影） */
    const consumeMessageStream = async (msg: AsyncIterable<any> & { text?: AsyncIterable<string>; reasoning?: AsyncIterable<string>; usage?: any }) => {
      try {
        if (msg.reasoning) {
          for await (const piece of msg.reasoning) {
            if (aborted()) return
            if (!piece) continue
            finalThought += piece
            pushText('reasoning', piece)
            ctx.onThought(piece)
          }
        }
        if (msg.text) {
          for await (const piece of msg.text) {
            if (aborted()) return
            if (!piece) continue
            finalContent += piece
            pushText('content', piece)
            ctx.onToken(piece)
          }
        }
        if (msg.usage) {
          try {
            const um = await msg.usage
            if (um && typeof um.input_tokens === 'number') {
              usageIn += um.input_tokens
              usageOut += um.output_tokens || 0
            }
          } catch { /* usage 缺失不影响流程 */ }
        }
      } catch { /* 单条消息流异常不中断整体 */ }
    }

    /** 消费一组工具调用流：start 即推送 input，output Promise 完成后回填 */
    const consumeToolCalls = async (toolCalls: AsyncIterable<any>) => {
      const pending: Promise<void>[] = []
      try {
        for await (const call of toolCalls) {
          if (aborted()) break
          // 防御性解包（v3 input 已解析，个别场景仍有双层包装）
          const toolInput = normalizeToolInput(call.input)
          const rec: { tool: string; input?: any; output?: any } = { tool: call.name, input: toolInput }
          finalTools.push(rec)
          const seg: TlSeg = { type: 'tool', tool: call.name, input: toolInput, running: true, runId: call.callId }
          timeline.push(seg)
          ctx.onTool({ tool: call.name, input: toolInput, runId: call.callId })
          // 输出异步回填：callId 即 tool_call_id，前端按 runId 精确匹配
          pending.push(
            Promise.resolve(call.output)
              .then(async (rawOut: any) => {
                let output: any = rawOut
                // Command 返回（write_todos / write_file 等状态更新型工具）：
                // 从 update.messages 取 ToolMessage 文本作为可展示输出
                if (output && typeof output === 'object' && 'update' in output && Array.isArray(output.update?.messages)) {
                  const tm = output.update.messages.find((m: any) => m?.content !== undefined)
                  if (tm) output = tm.content
                }
                if (typeof output === 'string' && output.length > 4000) output = output.slice(0, 4000) + '…'
                rec.output = output
                seg.output = output
                seg.running = false
                ctx.onTool({ tool: call.name, output, runId: call.callId })
              })
              .catch(() => { /* 工具失败已由 error 状态体现 */ })
          )
        }
      } catch { /* 工具流异常不中断整体 */ }
      await Promise.allSettled(pending)
    }

    /** 递归消费子代理（含嵌套子代理） */
    const consumeSubagents = async (subagents: AsyncIterable<any>) => {
      const tasks: Promise<void>[] = []
      try {
        for await (const sub of subagents) {
          if (aborted()) break
          tasks.push(
            (async () => {
              try {
                await Promise.all([
                  sub.messages ? consumeMessageStream(sub.messages) : Promise.resolve(),
                  sub.toolCalls ? consumeToolCalls(sub.toolCalls) : Promise.resolve(),
                  sub.subagents ? consumeSubagents(sub.subagents) : Promise.resolve()
                ])
              } catch { /* 单个子代理异常不中断整体 */ }
            })()
          )
        }
      } catch { /* 子代理流异常不中断整体 */ }
      await Promise.allSettled(tasks)
    }

    /** 消费一次运行（初始或 resume）的三个投影 */
    const consumeRun = async (run: DeepAgentRunStream) => {
      await Promise.all([
        (async () => {
          for await (const msg of run.messages) {
            if (aborted()) break
            await consumeMessageStream(msg)
          }
        })(),
        consumeToolCalls(run.toolCalls),
        consumeSubagents(run.subagents)
      ])
    }

    /**
     * HITL 中断处理：从 run.interrupts 提取确认请求，调 ctx.onHitl
     * 等用户选择，再 resume 断点续跑。
     * interrupts payload = HITLRequest { actionRequests, reviewConfigs }
     * 返回 resume 后的新 run（可能再次 interrupted），null = 用户忽略/中断
     */
    const handleInterrupt = async (run: DeepAgentRunStream): Promise<DeepAgentRunStream | null> => {
      const first = run.interrupts?.[0]
      const payload: any = (first as any)?.payload ?? first
      const reqs: any[] = payload?.actionRequests || []
      if (!reqs.length) return null
      const action = reqs[0]
      const decision = await ctx.onHitl({
        tool: action.name,
        input: action.args,
        prompt: String(action.description || `${action.name} ${JSON.stringify(action.args)}`)
      })
      if (aborted()) return null
      if (decision === 'ignore') {
        // 忽略本次请求：终止运行，不 resume
        cleanupHitlThread(ctx.threadKey)
        return null
      }
      // resume：approve 原参数执行；reject 拒绝并告知模型原因（可换路）
      const resumeRun: DeepAgentRunStream = await agent.streamEvents(
        new Command({
          resume: {
            decisions: reqs.map((r) =>
              decision === 'approve'
                ? { type: 'approve' as const }
                : { type: 'reject' as const, message: '用户不同意执行该删除操作' }
            )
          }
        }),
        lgConfig
      )
      await consumeRun(resumeRun)
      return resumeRun
    }

    // 初始输入（含 DB 历史）；后续 resume 走 Command。
    // 中断-恢复循环：一次运行可能触发多次破坏性工具确认
    let run: DeepAgentRunStream = await agent.streamEvents({ messages: historyMessages }, lgConfig)
    await consumeRun(run)
    while (run.interrupted && !aborted()) {
      const next = await handleInterrupt(run)
      if (!next) break
      run = next
    }

    // 文件由 backend 直连磁盘持久化（write 即落盘），无需状态同步
    // 归档 AI 回复给会话
    ctx.onReply({
      role: 'assistant',
      content: finalContent || (aborted() ? '(已中断)' : '(无回复)'),
      thought: finalThought || undefined,
      tools: finalTools.length ? finalTools : undefined,
      timeline: timeline.length ? timeline : undefined,
      usage: usageIn + usageOut > 0 ? { input: usageIn, output: usageOut } : undefined
    })
    ctx.onDone()
  } catch (e: any) {
    // AbortError：用户主动停止，不作为错误处理（已生成内容照常归档）
    if (e?.name === 'AbortError' || /abort/i.test(String(e?.message || ''))) {
      ctx.onDone()
      return
    }
    ctx.onError(e instanceof Error ? e : new Error(e?.message || '智能体执行失败'))
  } finally {
    activeRuns.delete(ctx.threadKey)
    // 运行结束：图状态已消费完毕（未中断），释放 checkpointer 内存；
    // Postgres 版删除本次一次性线程的持久化状态（防表膨胀）
    cleanupHitlThread(ctx.threadKey)
    if (pgSaver) {
      try {
        await pgSaver.deleteThread(threadId)
      } catch { /* 清理失败不影响主流程 */ }
    }
  }
}
