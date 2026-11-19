import { addDataAndFileToRequest, type Endpoint } from 'payload'
import { z } from 'zod'

import { cancelRegistrations } from '@/services/registrations'

import { requireStaff } from './guards'

const bodySchema = z.object({
  ids: z
    .array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]))
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
