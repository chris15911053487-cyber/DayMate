import postgres from 'postgres'
import { createDb } from '../src/db/client.ts'

/**
 * 接口测试用独立的测试库（默认 daymate_test，和开发库在同一个 PostgreSQL 上）。
 * 先 npm run dev:deps 起数据库；连不上时这些测试会失败并提示。
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://daymate:daymate@localhost:5432/daymate_test'

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL)
  const dbName = url.pathname.slice(1)
  const admin = postgres({ ...parseConn(url), database: 'postgres', onnotice: () => {} })
  try {
    const [row] = await admin`select 1 as ok from pg_database where datname = ${dbName}`
    if (!row) await admin.unsafe(`create database "${dbName}"`)
  } catch (err) {
    throw new Error(`连不上测试数据库 ${url.host}，先运行 npm run dev:deps：${(err as Error).message}`)
  } finally {
    await admin.end()
  }
  const { migrate, pg } = createDb(TEST_DATABASE_URL)
  await migrate(new URL('../drizzle', import.meta.url).pathname)
  await pg.end()
  process.env.TEST_DATABASE_URL = TEST_DATABASE_URL
}

function parseConn(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port) || 5432,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}
