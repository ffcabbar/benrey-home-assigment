import type { CollectionConfig, PayloadRequest } from 'payload'

import { isAdmin, isStaff, systemManaged } from '@/access/roles'
import { checkCapacityFloor, checkCapacityValue, checkSessionWithinEvent } from '@/domain/registration'
import { getDrizzle } from '@/lib/db'
import { assertRule, mapDbErrorsToResponse } from '@/lib/errors'
import { preventDeleteWhenReferenced, relationId } from '@/lib/hooks'
import { ATTENDEE_SESSION_SEPARATOR, sessionDisplayTitle } from '@/lib/labels'
import { sql } from '@payloadcms/db-postgres'

export const countConfirmed = async (req: PayloadRequest, sessionId: number | string) => {
  const { totalDocs } = await req.payload.count({
    collection: 'registrations',
    where: { and: [{ session: { equals: sessionId } }, { status: { equals: 'confirmed' } }] },
    req,
    overrideAccess: true,
  })
  return totalDocs
}

export const Sessions: CollectionConfig = {
  slug: 'sessions',
  labels: { singular: 'Session', plural: 'Sessions' },
  admin: {
    group: 'Events',
    // Session titles repeat across events, so they show as "Session — Event".
    useAsTitle: 'displayTitle',
    defaultColumns: ['title', 'eventTitle', 'startsAt', 'capacity', 'seatsLeft'],
    listSearchableFields: ['displayTitle', 'room'],
    description: 'Talks, workshops and other time slots inside an event. Each has a seat limit.',
  },
  defaultSort: 'startsAt',
  access: {
    read: isStaff,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        const merged = { ...originalDoc, ...data }
        assertRule(checkCapacityValue(merged.capacity), { path: 'capacity', collection: 'sessions' })

        let displayTitle: string | undefined
        const eventId = relationId(merged.event)
        if (eventId !== undefined) {
          const event = await req.payload.findByID({
            collection: 'events',
            id: eventId,
            depth: 0,
            select: { startsAt: true, endsAt: true, title: true },
            req,
            overrideAccess: true,
          })
          assertRule(checkSessionWithinEvent(merged, event), { path: 'startsAt', collection: 'sessions' })
          if (typeof merged.title === 'string') displayTitle = sessionDisplayTitle(merged.title, event.title)
        }

        if (operation === 'update' && originalDoc && merged.capacity !== originalDoc.capacity) {
          const confirmedCount = await countConfirmed(req, originalDoc.id)
          assertRule(checkCapacityFloor({ newCapacity: merged.capacity, confirmedCount }), {
            path: 'capacity',
            collection: 'sessions',
          })
        }
        return displayTitle === undefined ? data : { ...data, displayTitle }
      },
    ],
    afterChange: [
      // Raw SQL inside the request transaction, so the labels change with the rename or not at all.
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update' || doc.displayTitle === previousDoc?.displayTitle) return doc
        const db = await getDrizzle(req.payload, req)
        await db.execute(sql`
          UPDATE registrations r
          SET label = a.full_name || ${ATTENDEE_SESSION_SEPARATOR} || ${doc.displayTitle}
          FROM attendees a
          WHERE r.session_id = ${doc.id} AND a.id = r.attendee_id`)
        return doc
      },
    ],
    afterRead: [
      async ({ doc, req, context }) => {
        if (context?.skipSeatCount || doc?.id === undefined) return doc
        const taken = await countConfirmed(req, doc.id)
        doc.seatsTaken = taken
        doc.seatsLeft = typeof doc.capacity === 'number' ? Math.max(doc.capacity - taken, 0) : null
        return doc
      },
    ],
    beforeDelete: [
      preventDeleteWhenReferenced([{ collection: 'registrations', field: 'session', label: 'registration(s)' }]),
    ],
    afterError: [mapDbErrorsToResponse],
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
      index: true,
      admin: { description: 'The event this session belongs to. Its times must fit inside the event dates.' },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Name of the talk or workshop, e.g. "Opening keynote".' },
    },
    {
      name: 'displayTitle',
      label: 'Title with event',
      type: 'text',
      index: true,
      access: { create: systemManaged, update: systemManaged },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description:
          'Filled in automatically as "Session title — Event title", so sessions with the same name in different events can be told apart.',
      },
    },
    {
      name: 'eventTitle',
      label: 'Event',
      type: 'text',
      virtual: 'event.title',
      admin: {
        readOnly: true,
        // List column only (read on the server, so it shows at every screen width).
        condition: () => false,
        description: 'Title of the event this session belongs to.',
      },
    },
    {
      name: 'room',
      type: 'text',
      admin: { description: 'Room or stage inside the venue, e.g. "Hall A". Optional.' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'startsAt',
          label: 'Starts at',
          type: 'date',
          required: true,
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Start date and time. Must be on or after the event start.',
          },
        },
        {
          name: 'endsAt',
          label: 'Ends at',
          type: 'date',
          required: true,
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description:
              'End date and time. Must be after the start and no later than the event end. Sessions that end exactly when another starts do not overlap.',
          },
        },
      ],
    },
    {
      name: 'capacity',
      type: 'number',
      required: true,
      min: 1,
      admin: {
        step: 1,
        description:
          'Maximum number of confirmed attendees (whole number, at least 1). It cannot be set lower than the number already confirmed.',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'seatsTaken',
          type: 'number',
          virtual: true,
          admin: { readOnly: true, description: 'Confirmed registrations right now. Calculated, not editable.' },
        },
        {
          name: 'seatsLeft',
          type: 'number',
          virtual: true,
          admin: { readOnly: true, description: 'Capacity minus confirmed registrations. Calculated, not editable.' },
        },
      ],
    },
    {
      name: 'registrations',
      type: 'join',
      collection: 'registrations',
      on: 'session',
      defaultSort: '-registeredAt',
      defaultLimit: 25,
      admin: {
        defaultColumns: ['label', 'status', 'registeredAt'],
        description: 'Who is booked into this session, including cancelled registrations.',
      },
    },
  ],
}
