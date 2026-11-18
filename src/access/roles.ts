import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

export const ROLES = ['admin', 'staff'] as const
export type Role = (typeof ROLES)[number]

type UserLike = { id?: number | string; role?: unknown; collection?: string } | null | undefined

export const roleOf = (user: UserLike): Role | null => {
  if (!user || (user.collection !== undefined && user.collection !== 'users')) return null
  return ROLES.includes(user.role as Role) ? (user.role as Role) : null
}

export const userIsAdmin = (user: UserLike): boolean => roleOf(user) === 'admin'
export const userIsStaff = (user: UserLike): boolean => roleOf(user) !== null

const reqUser = (req: PayloadRequest) => req.user as UserLike

export const isAdmin: Access = ({ req }) => userIsAdmin(reqUser(req))
export const isStaff: Access = ({ req }) => userIsStaff(reqUser(req))
export const nobody: Access = () => false

// Staff need read access to their own record for Payload's /me endpoint.
export const isAdminOrSelf: Access = ({ req }) => {
  const user = reqUser(req)
  if (userIsAdmin(user)) return true
  if (userIsStaff(user) && user?.id !== undefined) {
    return { id: { equals: user.id } } satisfies Where
  }
  return false
}

export const canAccessAdmin = ({ req }: { req: PayloadRequest }): boolean =>
  userIsStaff(reqUser(req))

export const hiddenFromNonAdmins = ({ user }: { user: unknown }): boolean =>
  !userIsAdmin(user as UserLike)

export const systemManaged: FieldAccess = () => false

export const canChangeRole: FieldAccess = ({ req, id }) => {
  const user = reqUser(req)
  if (!userIsAdmin(user)) return false
  return id === undefined || String(id) !== String(user?.id)
}
