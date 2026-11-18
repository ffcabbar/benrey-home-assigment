import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

// Payload's migration file reader can't import .ts files under vitest, so pass them in.
export default async function setup() {
  const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${dbName}"`)

  const { default: config } = await import('../../src/payload.config')
  const { migrations } = await import('../../src/migrations')
  const payload = await getPayload({ config })
  const db = payload.db as unknown as PostgresAdapter
  await db.dropDatabase({ adapter: db })
  await db.migrate({ migrations: migrations as never })
  await payload.destroy()
}
