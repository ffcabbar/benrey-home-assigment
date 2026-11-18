import type { PayloadRequest } from 'payload'

export const ASSISTANT_LIMIT_PER_HOUR = 20
const WINDOW_MS = 60 * 60 * 1000

export type QuotaResult =
  | { allowed: true; limit: number; remaining: number }
  | { allowed: false; limit: number; retryAfterSeconds: number }

// Count-then-insert is not atomic, so a parallel burst can exceed the limit. The real spend
// ceiling is this limit plus the API key's spend limit.
export async function consumeAssistantQuota({
  req,
  userId,
  collection,
  limit = ASSISTANT_LIMIT_PER_HOUR,
  now = new Date(),
}: {
  req: PayloadRequest
  userId: number | string
  collection: string
  limit?: number
  now?: Date
}): Promise<QuotaResult> {
  const { payload } = req
  const windowStart = new Date(now.getTime() - WINDOW_MS)

  await payload.delete({
    collection: 'ai-usage',
    where: { and: [{ user: { equals: userId } }, { createdAt: { less_than: windowStart.toISOString() } }] },
    overrideAccess: true,
    req,
  })

  const recent = await payload.find({
    collection: 'ai-usage',
    where: { and: [{ user: { equals: userId } }, { createdAt: { greater_than_equal: windowStart.toISOString() } }] },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (recent.totalDocs >= limit) {
    const oldest = recent.docs[0]?.createdAt ? Date.parse(recent.docs[0].createdAt) : now.getTime()
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now.getTime()) / 1000))
    return { allowed: false, limit, retryAfterSeconds }
  }

  await payload.create({
    collection: 'ai-usage',
    data: { user: Number(userId), collectionSlug: collection },
    overrideAccess: true,
    req,
  })
  return { allowed: true, limit, remaining: limit - recent.totalDocs - 1 }
}
