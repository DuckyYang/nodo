import type { ModelConfig } from '../entities/UserConfig'
import { decrypt } from '../utils/SecretStore'
import { ChatOpenAI } from '@langchain/openai'

/**
 * 按 provider 构造 LangChain ChatModel。
 * 采用 OpenAI 兼容协议，覆盖 OpenAI / DeepSeek / Qwen / Zhipu / 自定义。
 *
 * @langchain/openai 1.6.2 原生支持 reasoning_content（DeepSeek R1 等模型的
 * 思考内容）：流式路径自动产出 reasoning-delta 事件，v3 投影 .reasoning
 * 直接可用，无需自定义 ChatModel 子类。
 */
export class LLMService {
  static build(cfg: ModelConfig | null | undefined, userId: number): ChatOpenAI | null {
    if (!cfg || !cfg.apiKey || !cfg.baseUrl) return null
    let apiKey = cfg.apiKey
    // 若以加密格式存储则解密
    if (apiKey.startsWith('v1:')) apiKey = decrypt(apiKey, userId)
    // 思考模式：按 provider/模型名注入对应开启参数，extraBody 可覆盖/扩展
    // 对照 Python 版实现：deepseek/glm/qwen 用 reasoning_effort
    const modelKwargs: Record<string, any> = {}
    const modelName = (cfg.name || '').toLowerCase()
    const isDeepseek = cfg.provider === 'deepseek' || modelName.includes('deepseek') || modelName === 'dsv4'
    const isGlm = modelName.includes('glm')
    const isQwen = cfg.provider === 'qwen' || modelName.includes('qwen')
    if (cfg.thinking) {
      if (isDeepseek || isGlm || isQwen) {
        modelKwargs.reasoning_effort = 'low'
      } else if (cfg.provider === 'openai') {
        modelKwargs.reasoning_effort = 'medium'
      } else if (cfg.provider === 'anthropic') {
        modelKwargs.thinking = { type: 'enabled', budget_tokens: 4096 }
      }
    }
    if (cfg.extraBody) {
      try {
        const extra = JSON.parse(cfg.extraBody)
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(modelKwargs, extra)
      } catch {
        // JSON 解析失败忽略
      }
    }
    return new ChatOpenAI({
      model: cfg.name || 'gpt-4o-mini',
      apiKey,
      configuration: { baseURL: cfg.baseUrl },
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3,
      streaming: true,
      ...(Object.keys(modelKwargs).length ? { modelKwargs } : {})
    })
  }

  /**
   * 非流式 + 关闭思考的后台任务构建（记忆抽取等一次性的 JSON 输出任务）：
   * - streaming: false（一次性返回，省流式开销）
   * - 强制不注入 thinking 参数（即使配置开了思考）
   * - 可覆盖 temperature（记忆抽取用 0 更稳定）
   */
  static buildFast(cfg: ModelConfig | null | undefined, userId: number, opts?: { temperature?: number }): ChatOpenAI | null {
    if (!cfg || !cfg.apiKey || !cfg.baseUrl) return null
    let apiKey = cfg.apiKey
    if (apiKey.startsWith('v1:')) apiKey = decrypt(apiKey, userId)
    const modelKwargs: Record<string, any> = {}
    // 关思考：对常见 provider 显式注入关闭参数（extraBody 仍可覆盖）
    const modelName = (cfg.name || '').toLowerCase()
    const isDeepseek = cfg.provider === 'deepseek' || modelName.includes('deepseek') || modelName === 'dsv4'
    const isGlm = modelName.includes('glm')
    const isQwen = cfg.provider === 'qwen' || modelName.includes('qwen')
    if (isDeepseek || isGlm || isQwen) modelKwargs.reasoning_effort = 'none'
    else if (cfg.provider === 'anthropic') modelKwargs.thinking = { type: 'disabled' }
    if (cfg.extraBody) {
      try {
        const extra = JSON.parse(cfg.extraBody)
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(modelKwargs, extra)
      } catch { /* JSON 解析失败忽略 */ }
    }
    return new ChatOpenAI({
      model: cfg.name || 'gpt-4o-mini',
      apiKey,
      configuration: { baseURL: cfg.baseUrl },
      temperature: opts?.temperature ?? 0,
      streaming: false,
      ...(Object.keys(modelKwargs).length ? { modelKwargs } : {})
    })
  }
}
