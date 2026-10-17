import { Entity, PrimaryGeneratedColumn, Column, OneToOne, Index, UpdateDateColumn } from 'typeorm'
import { User } from './User'

export interface ModelConfig {
  name?: string
  provider?: 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'anthropic' | 'custom'
  apiKey?: string // 后端会用 SecretStore 加密落库；这里以明文存储，加密由 SecretStore 统一处理
  baseUrl?: string
  temperature?: number
  /** 思考模式开关：开启后按 provider 注入 enable_thinking / reasoning effort 等参数 */
  thinking?: boolean
  /** 自定义透传参数（JSON），优先级最高，会覆盖上述默认参数；空对象/解析失败则忽略 */
  extraBody?: string
}

/** 模型用途类型 */
export type ModelType = 'chat' | 'embedding' | 'rerank' | 'ocr' | 'tts' | 'asr'

/** 模型列表项（合并后的多模型配置；id 用于引用） */
export interface ModelItem {
  id: string
  type: ModelType
  name: string
  provider?: string
  apiKey?: string // SecretStore 加密落库
  baseUrl?: string
  temperature?: number
  thinking?: boolean
  extraBody?: string
  /** embedding 专用：向量维度 */
  dimensions?: number
}

export interface BochaConfig {
  apiKey?: string
  baseUrl?: string
}

export interface WeChatConfig {
  /** 是否已扫码绑定 */
  bound?: boolean
  /** 扫码确认后获得：Bearer token（加密落库，iLink 接口认证用） */
  botToken?: string
  /** 扫码确认后获得：Bot 标识符 */
  ilinkBotId?: string
  /** 扫码确认后获得：扫码用户微信标识（xxx@im.wechat） */
  ilinkUserId?: string
  /** 扫码确认后获得：iLink API 基础 URL（可能覆盖默认值） */
  apiBaseUrl?: string
  /** getupdates 长轮询游标（get_updates_buf，重启续传） */
  cursor?: string
  boundAt?: string
}

export interface PostgresConfig {
  host?: string
  port?: number
  user?: string
  /** 加密落库（SecretStore），运行时解密 */
  password?: string
  database?: string
}

/** 向量模型配置（记忆功能 embedding 用，OpenAI 兼容协议） */
export interface EmbeddingConfig {
  name?: string
  provider?: 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'custom'
  apiKey?: string // SecretStore 加密落库
  baseUrl?: string
  /** 向量维度（须与模型输出一致；表结构按此建列，改维度需清空记忆重建） */
  dimensions?: number
}

@Entity('user_config')
export class UserConfig {
  @PrimaryGeneratedColumn()
  id!: number

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId!: number

  @Column({ name: 'model_config', type: 'json', nullable: true })
  modelConfig?: ModelConfig | null

  /** 模型列表（chat/embedding/rerank/ocr/tts/asr；旧 modelConfig/embeddingConfig 读取时自动迁移） */
  @Column({ name: 'model_items', type: 'json', nullable: true })
  modelItems?: ModelItem[] | null

  /** 偏好设置：记忆流水线使用的 chat 模型 id、最近使用的小助理 chat 模型 id */
  @Column({ name: 'model_prefs', type: 'json', nullable: true })
  modelPrefs?: { memoryModelId?: string; knowledgeModelId?: string; lastChatModelId?: string } | null

  @Column({ name: 'bocha_config', type: 'json', nullable: true })
  bochaConfig?: BochaConfig | null

  @Column({ name: 'wechat_config', type: 'json', nullable: true })
  wechatConfig?: WeChatConfig | null

  @Column({ name: 'postgres_config', type: 'json', nullable: true })
  postgresConfig?: PostgresConfig | null

  @Column({ name: 'embedding_config', type: 'json', nullable: true })
  embeddingConfig?: EmbeddingConfig | null

  @Column({ type: 'varchar', name: 'work_dir', length: 512, nullable: true })
  workDir?: string | null

  @Column({ type: 'varchar', name: 'theme_default', length: 16, default: 'light' })
  themeDefault!: 'light' | 'dark' | 'auto'

  @Column({ name: 'theme_follow_time', type: 'tinyint', default: 1, transformer: {
    to: (v: boolean) => (v ? 1 : 0),
    from: (v: number) => Boolean(v)
  } })
  themeFollowTime!: boolean

  @Column({ type: 'varchar', name: 'lang_default', length: 16, default: 'zh' })
  langDefault!: 'zh' | 'en' | 'auto'

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date

  @OneToOne(() => User)
  user?: User
}

export default UserConfig
