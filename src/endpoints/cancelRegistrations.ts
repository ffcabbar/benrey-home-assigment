import { addDataAndFileToRequest, type Endpoint } from 'payload'
import { z } from 'zod'

import { cancelRegistrations } from '@/services/registrations'

import { requireStaff } from './guards'

// Ids are Postgres `integer`s: a larger number would make the query fail with a 500.
const POSTGRES_INT_MAX = 2_147_483_647
const registrationId = z
  .union([z.number(), z.string().regex(/^\d{1,10}$/).transform(Number)])
  .pipe(z.number().int().positive().max(POSTGRES_INT_MAX))

const bodySchema = z.object({
  ids: z
    .array(registrationId)
    .min(1, 'Select at least one registration.')
    .max(500, 'Cancel at most 500 registrations at a time.'),
})

export const cancelRegistrationsEndpoint: Endpoint = {
  path: '/cancel',
  method: 'post',
  handler: async (req) => {
    const auth = requireStaff(req)
    if (!auth.ok) return auth.response

    await addDataAndFileToRequest(req)
    const parsed = bodySchema.safeParse(req.data)
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 },
      )
    }

    const { cancelled, skipped } = await cancelRegistrations({
      payload: req.payload,
      req,
      ids: parsed.data.ids,
      overrideAccess: false,
    })
    return Response.json({ cancelled, skipped })
  },
}
