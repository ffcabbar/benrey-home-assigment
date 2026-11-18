import { APIError, type CollectionConfig, type PayloadRequest } from 'payload'

import { canAccessAdmin, canChangeRole, hiddenFromNonAdmins, isAdmin, isAdminOrSelf, ROLES } from '@/access/roles'

const countAdmins = async (req: PayloadRequest) =>
  (await req.payload.count({ collection: 'users', where: { role: { equals: 'admin' } }, req, overrideAccess: true }))
    .totalDocs

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'User', plural: 'Users' },
  admin: {
    group: 'System',
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'role', 'updatedAt'],
    listSearchableFields: ['name', 'email'],
    hidden: hiddenFromNonAdmins,
    description: 'Staff accounts that can sign in to this admin. Only admins can see or change them.',
  },
  auth: {
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
    tokenExpiration: 60 * 60 * 8,
    removeTokenFromResponses: true,
    maxLoginAttempts: 10,
    lockTime: 10 * 60 * 1000,
  },
  access: {
    admin: canAccessAdmin,
    create: isAdmin,
    read: isAdminOrSelf,
    update: isAdminOrSelf,
    delete: isAdmin,
    unlock: isAdmin,
  },
  hooks: {
    beforeOperation: [
      // No email provider: refuse before Payload creates a reset token.
      ({ args, operation }) => {
        if (operation === 'forgotPassword' || operation === 'resetPassword') {
          throw new APIError(
            'Password reset by email is not available. Ask an admin to set a new password.',
            403,
            null,
            true,
          )
        }
        return args
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        if (req.user && String(req.user.id) === String(id)) {
          throw new APIError("You can't delete your own account. Ask another admin to do it.", 400, null, true)
        }
        const target = await req.payload.findByID({ collection: 'users', id, depth: 0, req, overrideAccess: true })
        if (target.role === 'admin' && (await countAdmins(req)) <= 1) {
          throw new APIError("You can't delete the last admin. Make someone else an admin first.", 400, null, true)
        }
      },
      // ai_usage.user_id is NOT NULL, so the rate-limit rows go first, in the same transaction.
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'ai-usage',
          where: { user: { equals: id } },
          req,
          overrideAccess: true,
        })
      },
    ],
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        if (operation === 'update' && originalDoc?.role === 'admin' && data.role && data.role !== 'admin') {
          if ((await countAdmins(req)) <= 1) {
            throw new APIError("You can't remove the last admin. Make someone else an admin first.", 400, null, true)
          }
        }
        return data
      },
      async ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const { totalDocs } = await req.payload.count({ collection: 'users', req, overrideAccess: true })
        if (totalDocs === 0) return { ...data, role: 'admin' }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Full name shown in the admin and on registrations this person creates.' },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'staff',
      saveToJWT: true,
      options: ROLES.map((role) => ({ label: role === 'admin' ? 'Admin' : 'Staff', value: role })),
      access: {
        create: canChangeRole,
        update: canChangeRole,
      },
      admin: {
        description:
          'Admin: full access, including users and deleting records. Staff: day-to-day work — read events and sessions, add attendees, register and cancel. You cannot change your own role.',
      },
    },
  ],
}
