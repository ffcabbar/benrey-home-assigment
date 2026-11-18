import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

// Raw SQL in hooks must run in the request's Payload transaction so it commits or rolls back
// with the document write.
export async function getDrizzle(payload: Payload, req?: Partial<PayloadRequest>) {
  const db = payload.db as unknown as PostgresAdapter
  const transactionID = req?.transactionID ? await req.transactionID : undefined
  if (transactionID !== undefined && db.sessions?.[transactionID]) {
    return db.sessions[transactionID].db
  }
  return db.drizzle
}
