import type { EmbeddingConfig } from '../entities/UserConfig'
import { decrypt } from '../utils/SecretStore'

/**
 * 向量模型服务（记忆功能 embedding）：
 * - OpenAI 兼容协议（/embeddings），覆盖 OpenAI / Qwen / Zhipu / 自定义
 * - 静态方法：embed（批量向量化）、probe（测试连接并返回实际维度）
 * - 复用 PostgreSQL 配置（与 HITL checkpointer 同库），记忆表单独建
 */
export class EmbeddingService {
  /** 解密 apiKey（兼容加密态与明文） */
  private static resolveKey(cfg: EmbeddingConfig, userId: number): string {
    let apiKey = cfg.apiKey || ''
    if (apiKey.startsWith('v1:')) apiKey = decrypt(apiKey, userId)
    return apiKey
  }

  /** 配置是否完整可用 */
  static isReady(cfg?: EmbeddingConfig | null): cfg is EmbeddingConfig {
    return Boolean(cfg?.apiKey && cfg.baseUrl && cfg.name)
  }

  /**
   * 批量向量化文本，返回 number[][]
   * @param dims 期望维度（校验模型输出一致性；不一致时抛错）
   */
  static async embed(texts: string[], cfg: EmbeddingConfig, userId: number, dims?: number): Promise<number[][]> {
    if (!texts.length) return []
    const apiKey = this.resolveKey(cfg, userId)
    const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '')
    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: cfg.name, input: texts }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`向量模型请求失败（${resp.status}）：${detail.slice(0, 200)}`)
    }
    const data: any = await resp.json()
    const list: any[] = data?.data || []
    if (list.length !== texts.length) throw new Error('向量模型返回数量与输入不一致')
    const vectors = list
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => {
        const v = d?.embedding
        if (!Array.isArray(v) || !v.every((x: any) => typeof x === 'number')) throw new Error('向量模型返回格式异常')
        return v as number[]
      })
    if (dims && vectors.length && vectors[0].length !== dims) {
      throw new Error(`向量维度不一致：模型输出 ${vectors[0].length}，配置为 ${dims}（请修改向量模型配置的维度）`)
    }
    return vectors
  }

  /** 测试连接：embed 一段文本，返回实际输出维度 */
  static async probe(cfg: EmbeddingConfig, userId: number): Promise<number> {
    const [v] = await this.embed(['nodo embedding probe'], cfg, userId)
    return v.length
  }
}
