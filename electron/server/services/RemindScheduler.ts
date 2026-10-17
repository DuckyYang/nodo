import { AppDataSource } from '../data-source'
import { Todo, type RemindRule } from '../entities/Todo'
import { pushRemindEvent } from './RemindQueue'

/**
 * 待办提醒调度器：
 * - 「开始提醒」：计划开始前 x 分钟触发（x = startBeforeMinutes，≥3）
 * - 「结束提醒」：计划完成前 x 分钟触发（x = endBeforeMinutes，≥3）
 * - 重复提醒：开启后在前 x 分钟 → 开始/完成 的窗口内，每隔 y 分钟再提醒（1 ≤ y ≤ x）
 * - 待办延期提醒已移除（不再按 planEnd < now 提醒）
 *
 * 每分钟扫描一次数据库（本地单机应用，负载可忽略），触发点通过
 * remindRule.lastStartRemindAt / lastEndRemindAt 做去重与间隔控制。
 *
 * 触发时双通道下发：
 * 1. 系统通知（主进程注入的 notifier，弹 Windows 通知）
 * 2. 应用内提醒事件（RemindQueue，前端轮询后展示左下角提醒卡片）
 */

export type RemindNotifier = (userId: number, title: string, body: string) => void

let timer: NodeJS.Timeout | null = null
let notifier: RemindNotifier | null = null

/** 注入系统通知回调（主进程在启动时桥接 Electron Notification） */
export function setRemindNotifier(fn: RemindNotifier) {
  notifier = fn
}

/**
 * 判断是否应该触发窗口内提醒（节律部分）：
 * - 窗口：(目标-x, 目标)，到点时刻起交给 isDeadlineHit 收尾
 * - 首次：进入窗口且从未提醒过
 * - 重复：开启 repeatEnabled 且距上次 ≥ y 分钟；y ≥ x 时窗口内只提醒首触一次
 */
function shouldRemind(now: number, targetTime: Date, x: number, y: number | undefined, lastAt: string | undefined): boolean {
  const diffMin = (targetTime.getTime() - now) / 60000
  // 未进入窗口 / 已到点（到点由 isDeadlineHit 负责收尾）
  if (diffMin <= 0 || diffMin > x) return false
  if (!lastAt) return true // 首次进入窗口
  if (!y || y < 1) return false
  if (y >= x) return false // 间隔 ≥ 提前量：窗口长度只够首触一次
  // 重复：距上次提醒超过 y 分钟
  return now - new Date(lastAt).getTime() >= y * 60000
}

/**
 * 到点收尾提醒：到达目标时间的那一刻必须提醒一次（「就是现在」）。
 * - 容忍 1 分钟扫描误差（目标时间落在两次扫描之间时不漏）
 * - 过点超过 1 分钟视为彻底错过，不再补（延期提醒已移除）
 * - 到点后已提醒过（lastAt ≥ 目标时间）则不重复
 */
function isDeadlineHit(now: number, targetTime: Date, lastAt: string | undefined): boolean {
  if (now < targetTime.getTime()) return false
  if (now - targetTime.getTime() > 60_000) return false
  if (lastAt && new Date(lastAt).getTime() >= targetTime.getTime()) return false
  return true
}

/** 扫描一轮：所有开启提醒且未完成的待办 */
async function scanOnce() {
  try {
    const repo = AppDataSource.getRepository(Todo)
    const todos = await repo.find({ where: { remindEnabled: true, done: false } })
    const now = Date.now()
    for (const t of todos) {
      const rule = t.remindRule
      if (!rule) continue
      let changed = false

      // 开始提醒（依赖计划开始时间）：窗口节律 + 到点收尾
      if (rule.startBeforeMinutes && rule.startBeforeMinutes >= 3 && t.planStart) {
        const x = rule.startBeforeMinutes
        const y = rule.repeatEnabled ? rule.repeatIntervalMinutes : undefined
        const repeatNote = y && y < x ? `（每 ${y} 分钟重复提醒）` : ''
        if (shouldRemind(now, t.planStart, x, y, rule.lastStartRemindAt)) {
          fire(t.userId, t.id, 'start', '待办即将开始', `「${t.content}」将于 ${fmt(t.planStart)} 开始，提前 ${x} 分钟提醒${repeatNote}`)
          rule.lastStartRemindAt = new Date().toISOString()
          changed = true
        } else if (isDeadlineHit(now, t.planStart, rule.lastStartRemindAt)) {
          // 到点：就是现在
          fire(t.userId, t.id, 'deadline-start', '待办开始', `「${t.content}」时间到，现在开始！`)
          rule.lastStartRemindAt = new Date().toISOString()
          changed = true
        }
      }

      // 结束提醒（依赖计划完成时间）：窗口节律 + 到点收尾
      if (rule.endBeforeMinutes && rule.endBeforeMinutes >= 3 && t.planEnd) {
        const x = rule.endBeforeMinutes
        const y = rule.repeatEnabled ? rule.repeatIntervalMinutes : undefined
        const repeatNote = y && y < x ? `（每 ${y} 分钟重复提醒）` : ''
        if (shouldRemind(now, t.planEnd, x, y, rule.lastEndRemindAt)) {
          fire(t.userId, t.id, 'end', '待办临近完成', `「${t.content}」计划 ${fmt(t.planEnd)} 完成，提前 ${x} 分钟提醒${repeatNote}`)
          rule.lastEndRemindAt = new Date().toISOString()
          changed = true
        } else if (isDeadlineHit(now, t.planEnd, rule.lastEndRemindAt)) {
          // 到点：该完成了
          fire(t.userId, t.id, 'deadline-end', '待办到点', `「${t.content}」到计划完成时间啦，快收尾吧！`)
          rule.lastEndRemindAt = new Date().toISOString()
          changed = true
        }
      }

      if (changed) {
        // 运行时状态写回数据库（去重/间隔控制的持久化依据）
        await repo.update(t.id, { remindRule: rule }).catch(() => {})
      }
    }
  } catch (err) {
    // 数据库未就绪等异常：静默等待下一轮
    if (process.env.NODE_ENV !== 'production') console.warn('[remind-scheduler] scan error:', err)
  }
}

/** 触发提醒：双通道下发（系统通知 + 应用内提醒事件队列→消息中心落库） */
async function fire(userId: number, todoId: number, kind: 'start' | 'end' | 'deadline-start' | 'deadline-end', title: string, body: string) {
  try {
    // 应用内提醒（落库消息中心 + 前端轮询拉取，展示左下角提醒卡片）
    await pushRemindEvent({ userId, todoId, kind, title, body })
  } catch {}
  try {
    // 系统通知（Windows 通知中心）
    notifier?.(userId, title, body)
  } catch {}
}

function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 启动调度器（每分钟一轮） */
export function startRemindScheduler() {
  if (timer) return
  timer = setInterval(scanOnce, 60_000)
  // 启动后 10 秒先扫一轮（应用启动立即补触发错过的提醒窗口）
  setTimeout(scanOnce, 10_000)
}

export function stopRemindScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
