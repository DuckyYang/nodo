import { http } from './http'

export interface ModelConfigDTO {
  name?: string
  provider?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
}

/** 模型用途类型 */
export type ModelType = 'chat' | 'embedding' | 'rerank' | 'ocr' | 'tts' | 'asr'

/** 模型列表项 */
export interface ModelItemDTO {
  id: string
  type: ModelType
  name: string
  provider?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  thinking?: boolean
  extraBody?: string
  dimensions?: number
}
export interface BochaConfigDTO { apiKey?: string; baseUrl?: string }
export interface WeChatConfigDTO {
  bound?: boolean
  botToken?: string
  ilinkBotId?: string
  ilinkUserId?: string
  apiBaseUrl?: string
  boundAt?: string
}
export interface PostgresConfigDTO {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
}
export interface EmbeddingConfigDTO {
  name?: string
  provider?: string
  apiKey?: string
  baseUrl?: string
  dimensions?: number
}
export interface WeChatQrCodeDTO { qrcodeUrl: string; qrcode: string }
export interface WeChatBindStatusDTO { status: 'wait' | 'scaned' | 'confirmed' | 'expired'; bound?: boolean; boundAt?: string }
export interface FullConfigDTO {
  id: number
  userId: number
  modelConfig?: ModelConfigDTO | null
  bochaConfig?: BochaConfigDTO | null
  wechatConfig?: WeChatConfigDTO | null
  postgresConfig?: PostgresConfigDTO | null
  embeddingConfig?: EmbeddingConfigDTO | null
  /** 模型列表（含旧数据自动迁移；apiKey 为掩码） */
  modelItems?: ModelItemDTO[] | null
  workDir?: string | null
  themeDefault: 'light' | 'dark'
  themeFollowTime: boolean
  langDefault: 'zh' | 'en'
  updatedAt: string
}

export const configApi = {
  get: () => http.get<{ config: FullConfigDTO }>('/config').then((r) => r.data.config),
  updateProfile: (p: { name?: string; phone?: string; avatarPath?: string }) => http.put('/config/profile', p).then((r) => r.data),
  updateModel: (p: ModelConfigDTO) => http.put('/config/model', p).then((r) => r.data),
  /** 模型列表：新增/更新（带 id = 更新） */
  upsertModel: (p: Partial<ModelItemDTO>) => http.put<{ model: ModelItemDTO }>('/config/models', p).then((r) => r.data),
  /** 模型列表：删除 */
  removeModel: (id: string) => http.delete(`/config/models/${id}`).then((r) => r.data),
  /** 模型连通性测试（embedding 返回维度） */
  testModel: (p: Partial<ModelItemDTO>) =>
    http.post<{ ok: boolean; dimensions?: number }>('/config/models/test', p, { timeout: 35000 }).then((r) => r.data),
  updateBocha: (p: BochaConfigDTO) => http.put('/config/bocha', p).then((r) => r.data),
  updatePostgres: (p: PostgresConfigDTO) => http.put('/config/postgres', p).then((r) => r.data),
  testPostgres: (p: PostgresConfigDTO) => http.post('/config/postgres/test', p, { timeout: 15000 }).then((r) => r.data),
  updateEmbedding: (p: EmbeddingConfigDTO) => http.put('/config/embedding', p).then((r) => r.data),
  testEmbedding: (p: EmbeddingConfigDTO) => http.post('/config/embedding/test', p, { timeout: 20000 }).then((r) => r.data),
  wechatQrCode: () => http.post<WeChatQrCodeDTO>('/config/wechat/bind/qrcode').then((r) => r.data),
  wechatBindStatus: (qrcode: string) =>
    http.post<WeChatBindStatusDTO>('/config/wechat/bind/status', { qrcode }, { timeout: 90000 }).then((r) => r.data),
  wechatUnbind: () => http.post('/config/wechat/unbind').then((r) => r.data),
  updateUi: (p: { themeDefault?: string; themeFollowTime?: boolean; langDefault?: string }) =>
    http.put('/config/ui', p).then((r) => r.data)
}
