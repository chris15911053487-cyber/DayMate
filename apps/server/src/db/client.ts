import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.ts'

export function createDb(url: string) {
  const pg = postgres(url, { max: 10, onnotice: () => {} })
  const db = drizzle(pg, { schema })
  return {
    pg,
    db,
    migrate: (migrationsFolder: string) => migrate(db, { migrationsFolder }),
    async ping() {
      try {
        await db.execute(sql`select 1`)
        return true
      } catch {
        return false
      }
    },
  }
}
export type Db = ReturnType<typeof createDb>['db']
