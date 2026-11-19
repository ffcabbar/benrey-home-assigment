import type { PayloadRequest } from 'payload'

import { userIsStaff } from '@/access/roles'

type SignedInUser = NonNullable<PayloadRequest['user']>

/**
 * Custom endpoints get no automatic access control: this is the check every one of them runs
 * first. Gives back the signed-in admin or staff member, or the error response to send.
 */
export function requireStaff(req: PayloadRequest): { ok: true; user: SignedInUser } | { ok: false; response: Response } {
  if (!req.user) return { ok: false, response: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  if (!userIsStaff(req.user)) return { ok: false, response: Response.json({ error: 'forbidden' }, { status: 403 }) }
  return { ok: true, user: req.user }
}
