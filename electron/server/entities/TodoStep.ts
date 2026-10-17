import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, Index } from 'typeorm'
import { Todo } from './Todo'

/** 待办步骤（子任务）：内容 + 完成标记 + 排序 */
@Entity('todo_step')
@Index(['todoId', 'sort'])
export class TodoStep {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'todo_id', type: 'int' })
  todoId!: number

  @Column({ type: 'text' })
  content!: string

  @Column({ type: 'tinyint', default: false, comment: '是否完成' })
  done!: boolean

  @Column({ type: 'int', default: 0, comment: '排序值，越小越靠前' })
  sort!: number

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @ManyToOne(() => Todo, (t) => t.steps, { onDelete: 'CASCADE' })
  todo?: Todo
}

export default TodoStep
