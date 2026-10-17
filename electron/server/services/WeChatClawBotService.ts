import axios from 'axios'
import crypto from 'crypto'
import QRCode from 'qrcode'
import type { WeChatConfig } from '../entities/UserConfig'

/**
 * 微信 ClawBot 接入（iLink Bot 协议，与腾讯官方 openclaw-weixin 插件同通道）。
 *
 * 扫码绑定（iLink 原生登录接口，无需任何配置与认证）：
 * - GET /ilink/bot/get_bot_qrcode?bot_type=3
 *   → { ret: 0, qrcode, qrcode_img_content }（qrcode_img_content 即二维码图片 URL）
 * - GET /ilink/bot/get_qrcode_status?qrcode=xxx（长轮询，带 iLink-App-ClientVersion 头）
 *   → { ret: 0, status }，status: wait / scaned / confirmed / expired；
 *   confirmed 时附带 bot_token / ilink_bot_id / ilink_user_id / baseurl
 *
 * 消息收发（同协议，凭据来自扫码 confirmed）：
 * - POST {baseurl}/ilink/bot/getupdates：长轮询收消息（~35s hold），
 *   { get_updates_buf: 游标 } → { msgs: [...], get_updates_buf }
 * - POST {baseurl}/ilink/bot/sendmessage：发文本，必须回带 context_token
 *
 * iLink 协议关键细节（缺一消息即被服务端静默丢弃，仍返回 200 {}）：
 * - 请求头：AuthorizationType: ilink_bot_token、Authorization: Bearer {bot_token}、
 *   X-WECHAT-UIN: base64(random_uint32)（每次请求随机生成）
 * - 请求体顶层：base_info: { channel_version: "1.0.3" }
 * - msg 必填：from_user_id: ""、client_id（每条唯一 UUID）、
 *   message_type: 2（BOT）、message_state: 2（FINISH）
 * - errcode -14 = 会话过期，需重新扫码
 */
export const ILINK_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
/** 微信媒体 CDN（语音/图片等，AES-128-ECB 加密） */
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
/** iLink 插件版本标识（base_info.channel_version） */
const ILINK_CHANNEL_VERSION = '1.0.3'

export interface QrCodeResult {
  /** 二维码图片 URL，可直接用于前端显示 */
  qrcodeUrl: string
  /** 二维码 token，用于后续状态轮询 */
  qrcode: string
}

export type QrStatus = 'wait' | 'scaned' | 'confirmed' | 'expired'

export interface QrStatusResult {
  status: QrStatus
  /** 仅 confirmed 时返回 */
  credentials?: { botToken: string; ilinkBotId: string; ilinkUserId: string }
  /** iLink API 基础 URL（可能覆盖默认值） */
  baseUrl?: string
}

/** getupdates 返回的单条消息 */
export interface IlinkIncomingMessage {
  fromUserId: string
  /** 回复必须回带的会话上下文令牌 */
  contextToken: string
  /** 文本内容：文本项直接取 text；语音项优先取微信自带转写（voice_item.text） */
  text: string
  /** 语音消息原始引用（text 为空时可下载音频自行处理） */
  voice?: { media?: { encryptQueryParam: string; aesKey: string; fullUrl?: string }; durationMs?: number }
}

export class WeChatClawBotService {
  constructor(private cfg: WeChatConfig | null | undefined) {}

  /** iLink API 地址（扫码确认时返回的 baseurl 优先） */
  get ilinkBaseUrl(): string {
    return (this.cfg?.apiBaseUrl || ILINK_DEFAULT_BASE_URL).replace(/\/$/, '')
  }

  get botToken(): string {
    return this.cfg?.botToken || ''
  }

  /** 是否已绑定（有 bot_token 即可收发消息） */
  isBound(): boolean {
    return Boolean(this.cfg?.bound && this.cfg?.botToken)
  }

  // ==================== 扫码绑定（iLink 原生登录接口，免认证） ====================

  /**
   * 获取微信登录二维码（GET /ilink/bot/get_bot_qrcode?bot_type=3）。
   * qrcode_img_content 是微信 H5 落地页（非图片），故用 qrcode 库
   * 将 qrcode token 本地渲染为 dataURL 图片。
   */
  async fetchQrCode(): Promise<QrCodeResult> {
    const { data } = await axios.get(`${ILINK_DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode`, {
      params: { bot_type: 3 },
      timeout: 15000
    })
    if (data?.ret !== 0) throw new Error(`获取二维码失败（ret=${data?.ret}）`)
    if (!data.qrcode) throw new Error('二维码响应缺少 qrcode 字段')
    const qrcodeUrl = await QRCode.toDataURL(`https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=${data.qrcode}&bot_type=3`, {
      width: 280,
      margin: 1
    })
    return { qrcodeUrl, qrcode: data.qrcode }
  }

  /** 轮询扫码状态（GET /ilink/bot/get_qrcode_status，长轮询）；confirmed 时返回凭据 */
  async pollQrStatus(qrcode: string): Promise<QrStatusResult> {
    const { data } = await axios.get(`${ILINK_DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status`, {
      params: { qrcode },
      headers: { 'iLink-App-ClientVersion': '1' },
      timeout: 70000
    }).catch((e: any) => {
      // 长轮询偶发超时属正常（腾讯官方插件同样处理：重试即可）
      if (e?.code === 'ECONNABORTED' || /timeout/i.test(String(e?.message || ''))) {
        return { data: { ret: 0, status: 'wait' } }
      }
      throw e
    })
    if (data?.ret !== 0) throw new Error(`查询扫码状态失败（ret=${data?.ret}）`)
    const result: QrStatusResult = { status: (data.status || 'wait') as QrStatus }
    if (data.baseurl) result.baseUrl = data.baseurl
    if (result.status === 'confirmed') {
      result.credentials = {
        botToken: data.bot_token || '',
        ilinkBotId: data.ilink_bot_id || '',
        ilinkUserId: data.ilink_user_id || ''
      }
    }
    return result
  }

  // ==================== 消息收发（iLink Bot 协议） ====================

  /** iLink 业务请求通用头（X-WECHAT-UIN 每次随机生成） */
  private ilinkHeaders(): Record<string, string> {
    const uin = Buffer.from(String(crypto.randomInt(0, 0xffffffff)), 'utf8').toString('base64')
    return {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: `Bearer ${this.botToken}`,
      'X-WECHAT-UIN': uin
    }
  }

  /**
   * 长轮询拉取新消息（POST /ilink/bot/getupdates，服务端 hold ~35s）。
   * cursor 为不透明游标：首次空串，每次响应回传新值；errcode -14 表示
   * 会话过期（调用方应停止轮询并提示重新扫码）。
   */
  async getUpdates(cursor: string): Promise<{ msgs: IlinkIncomingMessage[]; cursor: string; sessionExpired: boolean }> {
    const body = {
      get_updates_buf: cursor || '',
      base_info: { channel_version: ILINK_CHANNEL_VERSION }
    }
    const { data } = await axios.post(`${this.ilinkBaseUrl}/ilink/bot/getupdates`, body, {
      headers: this.ilinkHeaders(),
      timeout: 45000
    })
    if (data?.errcode === -14 || data?.ret === -14) {
      return { msgs: [], cursor, sessionExpired: true }
    }
    const msgs: IlinkIncomingMessage[] = []
    for (const m of data?.msgs || []) {
      if (!m?.from_user_id || !m?.context_token) continue
      // item_list 逐项提取：文本项直接取 text；语音项优先取微信自带
      // 转写文本（voice_item.text），没有转写时保留 CDN 引用供下载
      let text = ''
      let voice: IlinkIncomingMessage['voice']
      for (const item of m?.item_list || []) {
        if (item?.type === 1 && item?.text_item?.text) {
          text += item.text_item.text
        } else if (item?.type === 3 && item?.voice_item) {
          const v = item.voice_item
          if (v?.text) text += v.text
          if (v?.media && !voice) {
            voice = {
              media: {
                encryptQueryParam: v.media.encrypt_query_param || '',
                aesKey: v.media.aes_key || '',
                fullUrl: v.media.full_url
              },
              durationMs: v.playtime
            }
          }
        }
      }
      msgs.push({ fromUserId: m.from_user_id, contextToken: m.context_token, text, voice })
    }
    return { msgs, cursor: data?.get_updates_buf ?? cursor, sessionExpired: false }
  }

  /**
   * 下载语音消息音频（CDN + AES-128-ECB 解密，返回 SILK 原始数据）。
   * 语音被静默忽略时（无转写文本）的兜底通道；当前主流程不使用。
   */
  async downloadVoice(voice: NonNullable<IlinkIncomingMessage['voice']>): Promise<Buffer | null> {
    if (!voice.media?.encryptQueryParam && !voice.media?.fullUrl) return null
    const url = voice.media.fullUrl?.trim()
      || `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(voice.media.encryptQueryParam)}`
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 })
    const ciphertext = Buffer.from(resp.data)
    const key = decodeAesKey(voice.media.aesKey)
    return decryptAesEcb(ciphertext, key)
  }

  /**
   * 发送文本消息（POST /ilink/bot/sendmessage）。
   * 必须回带消息来源的 context_token，且补全幽灵字段
   * （from_user_id/client_id/message_type/message_state），
   * 否则服务端返回 200 {} 但不投递。
   * 长文本自动按自然边界分段发送。
   */
  async sendText(toUserId: string, contextToken: string, text: string): Promise<void> {
    const chunks = splitMessage(text, 2000)
    for (const chunk of chunks) {
      const body = {
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: `nodo-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [{ type: 1, text_item: { text: chunk } }]
        },
        base_info: { channel_version: ILINK_CHANNEL_VERSION }
      }
      const { data } = await axios.post(`${this.ilinkBaseUrl}/ilink/bot/sendmessage`, body, {
        headers: this.ilinkHeaders(),
        timeout: 15000
      })
      if (data?.errcode === -14 || data?.ret === -14) {
        throw new Error('会话已过期，请重新扫码绑定')
      }
    }
  }
}

/** 长文本分段：优先在换行处切，其次句读，硬上限兜底 */
export function splitMessage(text: string, maxLen: number): string[] {
  const t = (text || '').trim()
  if (!t) return []
  if (t.length <= maxLen) return [t]
  const chunks: string[] = []
  let rest = t
  while (rest.length > maxLen) {
    // 在上限内找最后一个换行 / 句读
    let cut = -1
    const window = rest.slice(0, maxLen)
    for (const sep of ['\n\n', '\n', '。', '；', '；', ';', '，', ',']) {
      const idx = window.lastIndexOf(sep)
      if (idx > Math.floor(maxLen * 0.3)) { cut = idx + sep.length; break }
    }
    if (cut <= 0) cut = maxLen
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut)
  }
  if (rest.trim()) chunks.push(rest.trim())
  return chunks
}

/**
 * 解码 CDN 媒体的 AES 密钥（协议存在三种编码格式）：
 * - 32 位 hex 字符串 → 直接 hex 解码
 * - base64(16 字节原始密钥) → 直接使用
 * - base64(32 位 hex 字符串) → base64 解码后再 hex 解码
 */
export function decodeAesKey(encoded: string): Buffer {
  if (/^[0-9a-fA-F]{32}$/.test(encoded)) return Buffer.from(encoded, 'hex')
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32) {
    const hex = decoded.toString('ascii')
    if (/^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, 'hex')
  }
  throw new Error(`无法解码 AES 密钥（base64 解码后长度 ${decoded.length}，应为 16 或 32）`)
}

/** AES-128-ECB 解密（微信 CDN 媒体统一加密方式，自带 PKCS7 去填充） */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
