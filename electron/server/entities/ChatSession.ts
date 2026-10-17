import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/** 对话消息：role = user | assistant */
export interface ChatMsgRecord {
  role: 'user' | 'assistant'
  content: string
  /** 用户消息附带的上传文件（历史恢复时独立渲染为文件卡） */
  attachments?: { name: string; relPath: string; size: number }[]
  thought?: string
  tools?: { tool: string; input?: any; output?: any }[]
  /**
   * AI 消息事件流时间线（按发生顺序）：reasoning / content / tool
   * 最后一个 content 段为最终总结；其余段属于思考过程
   */
  timeline?: { type: 'reasoning' | 'content' | 'tool'; text?: string; tool?: string; input?: any; output?: any; running?: boolean; runId?: string }[]
  /** HITL 确认卡（破坏性工具 interrupt）：用户选择后回填 decision */
  hitl?: { tool: string; input?: any; prompt: string; decision?: 'approve' | 'reject' | 'ignore' }
  /** 本轮 token 消耗（输入/输出，含工具循环的多轮模型调用） */
  usage?: { input: number; output: number }
  at: string
}

@Entity('chat_session')
export class ChatSession {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number

  /** 会话主题（由模型根据首条用户问题生成） */
  @Column({ type: 'varchar', length: 128, default: '' })
  title!: string

  /** 会话来源：app = 前端对话（默认），wxclaw = 微信 ClawBot 渠道（只读） */
  @Column({ type: 'varchar', length: 16, default: 'app' })
  source!: string

  /** 记忆开关：开启时对话前检索记忆注入上下文、结束后提取记忆（仅新会话可设置，会话期间不可切换） */
  @Column({ name: 'memory_enabled', type: 'tinyint', default: 1, transformer: {
    to: (v: boolean) => (v ? 1 : 0),
    from: (v: number) => Boolean(v)
  } })
  memoryEnabled!: boolean

  /** 本会话使用的 chat 模型 id（模型列表项；空 = 未指定，读取时回退 deepseek 命名优先 → 第一个 chat） */
  @Column({ name: 'model_id', type: 'varchar', length: 32, nullable: true })
  modelId?: string | null

  /** 归档的对话消息 JSON（含 thought/tools，前端恢复展示用） */
  @Column({ type: 'json', nullable: true })
  messages!: ChatMsgRecord[] | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
