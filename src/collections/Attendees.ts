import type { CollectionConfig } from 'payload'
import { sql } from '@payloadcms/db-postgres'

import { isAdmin, isStaff } from '@/access/roles'
import { getDrizzle } from '@/lib/db'
import { preventDeleteWhenReferenced } from '@/lib/hooks'
import { ATTENDEE_SESSION_SEPARATOR } from '@/lib/labels'

export const Attendees: CollectionConfig = {
  slug: 'attendees',
  labels: { singular: 'Attendee', plural: 'Attendees' },
  admin: {
    group: 'People',
    useAsTitle: 'fullName',
    defaultColumns: ['fullName', 'email', 'company', 'createdAt'],
    listSearchableFields: ['fullName', 'email', 'company'],
    description: 'People who attend sessions. One record per person, identified by email.',
  },
  defaultSort: 'fullName',
  access: {
    read: isStaff,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [
      // Raw SQL inside the request transaction, so the labels change with the rename or not at all.
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update' || doc.fullName === previousDoc?.fullName) return doc
        const db = await getDrizzle(req.payload, req)
        await db.execute(sql`
          UPDATE registrations r
          SET label = ${doc.fullName} || ${ATTENDEE_SESSION_SEPARATOR} || coalesce(s.display_title, s.title)
          FROM sessions s
          WHERE r.attendee_id = ${doc.id} AND s.id = r.session_id`)
        return doc
      },
    ],
    beforeDelete: [
      preventDeleteWhenReferenced([{ collection: 'registrations', field: 'attendee', label: 'registration(s)' }]),
    ],
  },
  fields: [
    {
      name: 'fullName',
      label: 'Full name',
      type: 'text',
      required: true,
      admin: { description: 'First and last name as the attendee wants it on their badge.' },
    },
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      index: true,
      hooks: {
        beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)],
      },
      admin: {
        description: 'Contact email. Must be unique: one attendee record per email address. Stored in lower case.',
      },
    },
    {
      name: 'company',
      type: 'text',
      admin: { description: 'Company or organisation. Optional.' },
    },
    {
      name: 'registrations',
      type: 'join',
      collection: 'registrations',
      on: 'attendee',
      defaultSort: '-registeredAt',
      defaultLimit: 25,
      admin: {
        defaultColumns: ['label', 'status', 'registeredAt'],
        description: 'Sessions this attendee is registered for, including cancelled registrations.',
      },
    },
  ],
}
