import type {
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  CollectionConfig,
} from 'payload'

import { isAdmin, isStaff } from '@/access/roles'
import { checkEventStillContainsSessions, checkTimeRange } from '@/domain/registration'
import { assertRule } from '@/lib/errors'
import { sql } from '@payloadcms/db-postgres'

import { getDrizzle } from '@/lib/db'
import { preventDeleteWhenReferenced, slugify } from '@/lib/hooks'
import { ATTENDEE_SESSION_SEPARATOR, SESSION_EVENT_SEPARATOR } from '@/lib/labels'

/** The event must end after it starts, and new dates must still contain all of its sessions. */
const validateEventDates: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const merged = { ...originalDoc, ...data }
  assertRule(checkTimeRange(merged, 'The event'), { path: 'endsAt', collection: 'events' })

  const datesChanged =
    operation === 'update' &&
    originalDoc &&
    (String(merged.startsAt) !== String(originalDoc.startsAt) || String(merged.endsAt) !== String(originalDoc.endsAt))
  if (!datesChanged) return data

  const { docs } = await req.payload.find({
    collection: 'sessions',
    where: { event: { equals: originalDoc.id } },
    depth: 0,
    limit: 0,
    pagination: false,
    select: { title: true, startsAt: true, endsAt: true },
    req,
    overrideAccess: true,
  })
  assertRule(checkEventStillContainsSessions(merged, docs), { path: 'startsAt', collection: 'events' })
  return data
}

// Raw SQL inside the request transaction: an event rename updates its sessions' titles and
// the registration labels built from them, or nothing.
const retitleSessionsOnRename: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || doc.title === previousDoc?.title) return doc
  const db = await getDrizzle(req.payload, req)
  await db.execute(sql`
    UPDATE sessions
    SET display_title = title || ${SESSION_EVENT_SEPARATOR} || ${doc.title}
    WHERE event_id = ${doc.id}`)
  await db.execute(sql`
    UPDATE registrations r
    SET label = a.full_name || ${ATTENDEE_SESSION_SEPARATOR} || s.display_title
    FROM sessions s, attendees a
    WHERE s.event_id = ${doc.id} AND r.session_id = s.id AND a.id = r.attendee_id`)
  return doc
}

const addSessionCount: CollectionAfterReadHook = async ({ doc, req, context }) => {
  if (context?.skipSessionCount || doc?.id === undefined) return doc
  const { totalDocs } = await req.payload.count({
    collection: 'sessions',
    where: { event: { equals: doc.id } },
    req,
    overrideAccess: true,
  })
  doc.sessionCount = totalDocs
  return doc
}

export const Events: CollectionConfig = {
  slug: 'events',
  labels: { singular: 'Event', plural: 'Events' },
  admin: {
    group: 'Events',
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'startsAt', 'venue', 'sessionCount'],
    listSearchableFields: ['title', 'venue'],
    description: 'Conferences and meetups. Each event has sessions that attendees register for.',
  },
  defaultSort: '-startsAt',
  // Staff can only read events; a lock would only show them a "take over" prompt.
  lockDocuments: false,
  access: {
    read: isStaff,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [validateEventDates],
    afterChange: [retitleSessionsOnRename],
    afterRead: [addSessionCount],
    beforeDelete: [preventDeleteWhenReferenced([{ collection: 'sessions', field: 'event', label: 'session(s)' }])],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Public name of the event, e.g. "Berlin Product Summit 2026".' },
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Short URL-friendly name. Leave empty to create it from the title. Must be unique.',
      },
      hooks: {
        beforeValidate: [
          ({ value, data }) => {
            if (typeof value === 'string' && value.trim() !== '') return slugify(value)
            return typeof data?.title === 'string' ? slugify(data.title) : value
          },
        ],
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Draft: being prepared, no registrations. Published: open for registrations. Cancelled: called off, no new registrations.',
      },
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
            description: 'When the event begins (date and time). All its sessions must start on or after this.',
          },
        },
        {
          name: 'endsAt',
          label: 'Ends at',
          type: 'date',
          required: true,
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'When the event ends. Must be after the start. All sessions must end by this time.',
          },
        },
      ],
    },
    {
      name: 'venue',
      type: 'text',
      required: true,
      admin: { description: 'Where it takes place: venue name and city, e.g. "Station Berlin, Berlin".' },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { description: 'A few sentences about the event for staff and attendees. Optional.' },
    },
    {
      name: 'banner',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Optional banner image (JPEG, PNG or WebP, max 2 MB).' },
    },
    {
      name: 'sessionCount',
      label: 'Sessions',
      type: 'number',
      virtual: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Number of sessions in this event. Calculated, not editable.',
      },
    },
    {
      name: 'sessions',
      type: 'join',
      collection: 'sessions',
      on: 'event',
      defaultSort: 'startsAt',
      defaultLimit: 20,
      admin: {
        defaultColumns: ['title', 'room', 'startsAt', 'endsAt', 'capacity'],
        description: 'Talks and workshops in this event. Use "Add new" to create one already linked to this event.',
      },
    },
  ],
}
