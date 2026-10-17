import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, Index } from 'typeorm'
import { User } from './User'
import { Todo } from './Todo'

@Entity('todo_group')
export class TodoGroup {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId!: number

  @Column({ type: 'varchar', length: 100 })
  name!: string

  @Column({ type: 'int', default: 0, comment: '排序值，越小越靠前' })
  sort!: number

  @Column({ type: 'tinyint', default: false, comment: '是否置顶' })
  pinned!: boolean

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @ManyToOne(() => User, (u) => u.groups)
  user?: User

  @OneToMany(() => Todo, (t) => t.group)
  todos?: Todo[]
}

export default TodoGroup
