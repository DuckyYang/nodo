import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, Index, OneToMany } from 'typeorm'
import { User } from './User'
import { TodoGroup } from './TodoGroup'
import { TodoStep } from './TodoStep'

/**
 * 提醒规则 JSON：
 *  {
 *    startBeforeMinutes?: number;  // 开始提醒：计划开始前 x 分钟（≥3）
 *    endBeforeMinutes?: number;    // 结束提醒：计划完成前 x 分钟（≥3）
 *    repeatEnabled: boolean;       // 重复提醒：在前 x 分钟 → 开始/完成 时间段内，每隔 y 分钟提醒一次
 *    repeatIntervalMinutes?: number; // 重复间隔 y 分钟（1 ≤ y ≤ x）
 *    // 运行时状态（调度器维护，不由用户编辑）：
 *    lastStartRemindAt?: string;   // 上次开始提醒触发时间
 *    lastEndRemindAt?: string;     // 上次结束提醒触发时间
 *  }
 */
export interface RemindRule {
  startBeforeMinutes?: number
  endBeforeMinutes?: number
  repeatEnabled: boolean
  repeatIntervalMinutes?: number
  lastStartRemindAt?: string
  lastEndRemindAt?: string
}

/**
 * 待办状态（与 done 布尔并存，后端自动同步）：
 * not_started = 未开始 | in_progress = 进行中 | completed = 已完成
 * 「已延期」不落库：由 planEnd < now 且未完成实时推导（避免过期失真）
 */
export type TodoStatus = 'not_started' | 'in_progress' | 'completed'

@Entity('todo')
export class Todo {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number

  @Index()
  @Column({ name: 'group_id', type: 'int', nullable: true })
  groupId?: number | null

  @Column({ type: 'text' })
  content!: string

  @Column({ type: 'text', nullable: true })
  remark?: string

  @Column({ type: 'tinyint', default: false, comment: '是否搁置' })
  shelved!: boolean

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '负责人' })
  owner?: string

  @Column({ type: 'json', nullable: true, comment: '协作人列表' })
  collaborators?: string[] | null

  @Column({ name: 'plan_start', type: 'datetime', nullable: true })
  planStart?: Date | null

  @Column({ name: 'plan_end', type: 'datetime', nullable: true })
  planEnd?: Date | null

  @Column({ type: 'tinyint', default: false, comment: '是否完成' })
  done!: boolean

  @Column({
    name: 'status', type: 'varchar', length: 20,
    default: 'not_started', comment: '状态：not_started/in_progress/completed'
  })
  status!: TodoStatus

  @Column({ name: 'done_at', type: 'datetime', nullable: true })
  doneAt?: Date | null

  @Column({ type: 'int', default: 0, comment: '排序值，越小越靠前' })
  sort!: number

  @Column({ type: 'tinyint', default: false, comment: '是否置顶' })
  pinned!: boolean

  @Column({ name: 'remind_enabled', type: 'tinyint', default: false })
  remindEnabled!: boolean

  @Column({ name: 'remind_rule', type: 'json', nullable: true })
  remindRule?: RemindRule | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @ManyToOne(() => User, (u) => u.todos)
  user?: User

  @ManyToOne(() => TodoGroup, (g) => g.todos)
  group?: TodoGroup | null

  @OneToMany(() => TodoStep, (s) => s.todo)
  steps?: TodoStep[]
}

export default Todo
