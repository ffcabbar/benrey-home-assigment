import type { PayloadRequest } from 'payload'

type ID = number | string

/** Confirmed registrations of a session: the seats it has taken. Runs inside the request's transaction. */
export async function countConfirmedRegistrations(req: PayloadRequest, sessionId: ID): Promise<number> {
  const { totalDocs } = await req.payload.count({
    collection: 'registrations',
    where: { and: [{ session: { equals: sessionId } }, { status: { equals: 'confirmed' } }] },
    req,
    overrideAccess: true,
  })
  return totalDocs
}

/**
 * Read context for hooks that only need a session's stored fields: skips the seat-count query
 * the Sessions afterRead hook would otherwise run for every session read. A fresh object each
 * time, because Payload may use it as `req.context` by reference.
 */
export const withoutSeatCounts = () => ({ skipSeatCount: true })
