import { tavily } from '@tavily/core'
import type { BochaConfig } from '../entities/UserConfig'

export interface SearchHit {
  title: string
  url: string
  snippet: string
  publisher?: string
  publishedAt?: string
}

/**
 * Tavily 联网检索（官方 SDK：@tavily/core）
 * 文档参考：https://docs.tavily.com/sdk/javascript/reference
 *
 * 复用 bochaConfig 存储（apiKey/baseUrl 字段语义一致，避免数据库迁移）。
 */
export class TavilyService {
  private client: ReturnType<typeof tavily> | null = null

  constructor(private cfg: BochaConfig | null | undefined) {
    if (cfg?.apiKey) {
      this.client = tavily({ apiKey: cfg.apiKey })
    }
  }

  async search(query: string, maxResults = 8): Promise<{ hits: SearchHit[]; summary: string }> {
    if (!this.client) throw new Error('Tavily api_key 未配置')
    const resp = await this.client.search(query, {
      maxResults,
      searchDepth: 'basic',
      includeAnswer: true
    })
    const hits: SearchHit[] = (resp.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      publisher: r.url ? new URL(r.url).hostname : undefined
    }))
    return { hits, summary: (resp as any).answer || hits[0]?.snippet || '' }
  }
}
