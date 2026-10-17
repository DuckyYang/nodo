import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, Index } from 'typeorm'
import { TodoGroup } from './TodoGroup'
import { Todo } from './Todo'
import { UserConfig } from './UserConfig'

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id!: number

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 191, comment: '邮箱即登录名' })
  email!: string

  @Column({ type: 'varchar', name: 'password_hash', length: 100, select: false, comment: 'bcrypt 哈希' })
  passwordHash!: string

  @Column({ type: 'varchar', length: 64, nullable: true })
  name?: string

  @Column({ type: 'varchar', name: 'avatar_path', length: 255, nullable: true })
  avatarPath?: string

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone?: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @OneToMany(() => TodoGroup, (g) => g.user)
  groups?: TodoGroup[]

  @OneToMany(() => Todo, (t) => t.user)
  todos?: Todo[]

  @OneToMany(() => UserConfig, (c) => c.user)
  configs?: UserConfig[]
}

export default User
