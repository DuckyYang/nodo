import 'reflect-metadata'
import { DataSource } from 'typeorm'
import mysql from 'mysql2/promise'
import { env } from './env'
import { User } from './entities/User'
import { TodoGroup } from './entities/TodoGroup'
import { Todo } from './entities/Todo'
import { UserConfig } from './entities/UserConfig'
import { ChatSession } from './entities/ChatSession'
import { TodoStep } from './entities/TodoStep'
import { Message } from './entities/Message'

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: env.db.host,
  port: env.db.port,
  username: env.db.user,
  password: env.db.password,
  database: env.db.name,
  entities: [User, TodoGroup, Todo, TodoStep, UserConfig, ChatSession, Message],
  synchronize: true, // 开发期自动建表；生产应改 migration
  logging: false,
  poolSize: 10,
  extra: {
    connectionLimit: 10,
    connectTimeout: 10000,
    waitForConnections: true
  }
})

let initialized = false

/** 如果数据库不存在则自动创建（MySQL 不会自动建库，只自动建表） */
async function ensureDatabase() {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    connectTimeout: 10000
  })
  try {
    await conn.execute(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await conn.end()
  }
}

export async function ensureDataSource(): Promise<DataSource> {
  if (!initialized) {
    await ensureDatabase()
    await AppDataSource.initialize()
    initialized = true
  }
  return AppDataSource
}
