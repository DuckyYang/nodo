import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * 消息分类（维度后续可扩展）：
 * todo    = 待办消息（提醒触发等）
 * assistant = 小助理消息（预留）
 */
export type MessageCategory = 'todo' | 'assistant'

/**
 * 软件消息中心的消息实体：
 * - 未读/已读通过 read 标记
 * - 来源业务关联 refType + refId（如待办提醒 refType='todo' refId=todoId），
 *   提醒卡片的操作可据此同步处理对应消息
 */
@Entity('message')
@Index(['userId', 'createdAt'])
@Index(['userId', 'read'])
export class Message {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number

  @Column({
    type: 'varchar', length: 20, default: 'todo',
    comment: '分类：todo=待办消息 assistant=小助理消息'
  })
  category!: MessageCategory

  @Column({ type: 'varchar', length: 200 })
  title!: string

  @Column({ type: 'text' })
  content!: string

  @Column({ type: 'tinyint', default: false, comment: '是否已读' })
  read!: boolean

  /** 来源类型：todo=待办提醒（预留扩展） */
  @Column({ name: 'ref_type', type: 'varchar', length: 20, nullable: true })
  refType?: string | null

  /** 来源 id（如 todoId） */
  @Column({ name: 'ref_id', type: 'int', nullable: true })
  refId?: number | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date
}

export default Message
