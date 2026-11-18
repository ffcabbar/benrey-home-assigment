import type { Payload, PayloadRequest } from 'payload'

import { planCancellation, type ID } from '@/domain/registration'
import { mapDbError } from '@/lib/errors'

type ServiceArgs = {
  payload: Payload
  req?: Partial<PayloadRequest>
  overrideAccess?: boolean
}

export async function registerAttendee({
  payload,
  req,
  attendeeId,
  sessionId,
  overrideAccess = true,
  clock,
}: ServiceArgs & { attendeeId: ID; sessionId: ID; clock?: Date }) {
  try {
    return await payload.create({
      collection: 'registrations',
      data: { attendee: Number(attendeeId), session: Number(sessionId), status: 'confirmed' },
      depth: 0,
      req,
      overrideAccess,
      context: clock ? { registrationClock: clock } : undefined,
    })
  } catch (error) {
    throw mapDbError(error) ?? error
  }
}

export async function cancelRegistrations({
  payload,
  req,
  ids,
  overrideAccess = true,
  clock,
}: ServiceArgs & { ids: ID[]; clock?: Date }): Promise<{ cancelled: number; skipped: number; cancelledIds: ID[] }> {
  const uniqueIds = [...new Set(ids.map(String))]
  if (uniqueIds.length === 0) return { cancelled: 0, skipped: 0, cancelledIds: [] }

  const { docs } = await payload.find({
    collection: 'registrations',
    where: { id: { in: uniqueIds } },
    depth: 0,
    limit: 0,
    pagination: false,
    select: { status: true },
    req,
    overrideAccess,
  })
  const { toCancel } = planCancellation(docs)
  if (toCancel.length === 0) return { cancelled: 0, skipped: uniqueIds.length, cancelledIds: [] }

  // Repeat the status filter so a row cancelled in the meantime is not updated again.
  const result = await payload.update({
    collection: 'registrations',
    where: {
      and: [{ id: { in: toCancel.map((row) => row.id) } }, { status: { equals: 'confirmed' } }],
    },
    data: { status: 'cancelled' },
    depth: 0,
    req,
    overrideAccess,
    context: clock ? { registrationClock: clock } : undefined,
  })
  const cancelledIds = result.docs.map((doc) => doc.id)
  return { cancelled: cancelledIds.length, skipped: uniqueIds.length - cancelledIds.length, cancelledIds }
}
