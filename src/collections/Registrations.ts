import type { Access, CollectionBeforeChangeHook, CollectionBeforeOperationHook, CollectionConfig } from 'payload'

import { isAdmin, isStaff, systemManaged, userIsStaff } from '@/access/roles'
import {
  checkInitialStatus,
  checkRegistrationUpdate,
  IMMUTABLE_MESSAGE,
  validateNewRegistration,
  type RegistrationStatus,
} from '@/domain/registration'
import { cancelRegistrationsEndpoint } from '@/endpoints/cancelRegistrations'
import { assertRule, mapDbErrorsToResponse, RuleViolationError } from '@/lib/errors'
import { relationId } from '@/lib/hooks'

const canUpdateConfirmed: Access = ({ req }) =>
  userIsStaff(req.user) ? { status: { equals: 'confirmed' } } : false

// The seed pins a historical clock through req.context (server-only), since rule 3 refuses ended sessions.
const clockFrom = (context: Record<string, unknown> | undefined): Date => {
  const pinned = context?.registrationClock
  return pinned instanceof Date && Number.isFinite(pinned.getTime()) ? pinned : new Date()
}

// Field access already ignores attendee/session on update; this turns that silent no-op into a 400.
const rejectReassignment: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update') return args
  const data = (args.data ?? {}) as Record<string, unknown>
  const attendee = relationId(data.attendee)
  const session = relationId(data.session)
  if (attendee === undefined && session === undefined) return args

  const id = (args as { id?: number | string }).id
  if (id === undefined) {
    throw new RuleViolationError('REGISTRATION_IMMUTABLE', IMMUTABLE_MESSAGE)
  }
  const current = await req.payload
    .findByID({ collection: 'registrations', id, depth: 0, req, overrideAccess: true, select: { attendee: true, session: true } })
    .catch(() => null)
  if (!current) return args
  const previous = { attendeeId: relationId(current.attendee)!, sessionId: relationId(current.session)!, status: 'confirmed' as const }
  assertRule(
    checkRegistrationUpdate(previous, {
      attendeeId: attendee ?? previous.attendeeId,
      sessionId: session ?? previous.sessionId,
      status: 'confirmed',
    }),
  )
  return args
}

const validateRegistration: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req, context }) => {
  const now = clockFrom(context)

  if (operation === 'update') {
    if (!originalDoc) return data
    const previous = {
      attendeeId: relationId(originalDoc.attendee)!,
      sessionId: relationId(originalDoc.session)!,
      status: originalDoc.status as RegistrationStatus,
    }
    const next = {
      attendeeId: relationId(data.attendee) ?? previous.attendeeId,
      sessionId: relationId(data.session) ?? previous.sessionId,
      status: (data.status ?? previous.status) as RegistrationStatus,
    }
    assertRule(checkRegistrationUpdate(previous, next))
    if (previous.status === 'confirmed' && next.status === 'cancelled') {
      return { ...data, status: 'cancelled', cancelledAt: now.toISOString() }
    }
    return data
  }

  assertRule(checkInitialStatus(data.status))
  const attendeeId = relationId(data.attendee)
  const sessionId = relationId(data.session)
  if (attendeeId === undefined || sessionId === undefined) return data

  // Sequential on purpose: inside a transaction all queries share one connection.
  const readCtx = { skipSeatCount: true }
  const attendee = await req.payload.findByID({
    collection: 'attendees',
    id: attendeeId,
    depth: 0,
    req,
    overrideAccess: true,
    select: { fullName: true },
  })
  const session = await req.payload.findByID({
    collection: 'sessions',
    id: sessionId,
    depth: 0,
    req,
    overrideAccess: true,
    context: readCtx,
  })
  const event = await req.payload.findByID({
    collection: 'events',
    id: relationId(session.event)!,
    depth: 0,
    req,
    overrideAccess: true,
    select: { status: true },
  })
  const confirmed = await req.payload.count({
    collection: 'registrations',
    where: { and: [{ session: { equals: sessionId } }, { status: { equals: 'confirmed' } }] },
    req,
    overrideAccess: true,
  })
  const bookings = await req.payload.find({
    collection: 'registrations',
    where: { and: [{ attendee: { equals: attendeeId } }, { status: { equals: 'confirmed' } }] },
    depth: 0,
    limit: 0,
    pagination: false,
    select: { session: true },
    req,
    overrideAccess: true,
  })
  const bookedSessionIds = bookings.docs.map((b) => relationId(b.session)!).filter((id) => id !== undefined)
  const bookedSessions = bookedSessionIds.length
    ? (
        await req.payload.find({
          collection: 'sessions',
          where: { id: { in: bookedSessionIds } },
          depth: 0,
          limit: 0,
          pagination: false,
          select: { title: true, startsAt: true, endsAt: true },
          req,
          overrideAccess: true,
          context: readCtx,
        })
      ).docs
    : []

  assertRule(
    validateNewRegistration({
      now,
      event: { status: event.status },
      session: {
        id: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: session.capacity,
        confirmedCount: confirmed.totalDocs,
      },
      attendeeBookings: bookedSessions.map((s) => ({
        sessionId: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      })),
    }),
  )

  const user = req.user
  return {
    ...data,
    status: 'confirmed',
    registeredAt: now.toISOString(),
    cancelledAt: null,
    createdBy: user && user.collection === 'users' ? user.id : null,
    label: `${attendee.fullName} → ${session.title}`,
  }
}

export const Registrations: CollectionConfig = {
  slug: 'registrations',
  labels: { singular: 'Registration', plural: 'Registrations' },
  admin: {
    group: 'People',
    useAsTitle: 'label',
    defaultColumns: ['attendee', 'session', 'status', 'registeredAt'],
    listSearchableFields: ['label', 'attendee.email'],
    description:
      'Bookings of an attendee into a session. Cancel instead of editing: a cancelled registration is final, register again to create a new one.',
    components: {
      beforeListTable: ['@/components/admin/CancelSelectedRegistrations#CancelSelectedRegistrations'],
    },
  },
  defaultSort: '-registeredAt',
  access: {
    read: isStaff,
    create: isStaff,
    update: canUpdateConfirmed,
    delete: isAdmin,
  },
  endpoints: [cancelRegistrationsEndpoint],
  hooks: {
    beforeOperation: [rejectReassignment],
    beforeChange: [validateRegistration],
    afterError: [mapDbErrorsToResponse],
  },
  fields: [
    {
      name: 'label',
      type: 'text',
      access: { create: systemManaged, update: systemManaged },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Filled in automatically as "Attendee → Session".',
      },
    },
    {
      name: 'attendee',
      type: 'relationship',
      relationTo: 'attendees',
      required: true,
      index: true,
      access: { update: systemManaged },
      admin: {
        description: 'Who is attending. Can’t be changed after saving: cancel and register again instead.',
      },
    },
    {
      name: 'session',
      type: 'relationship',
      relationTo: 'sessions',
      required: true,
      index: true,
      access: { update: systemManaged },
      admin: {
        description:
          'The session to book. Its event must be published, the session must not have ended, it needs a free seat, and it must not overlap the attendee’s other sessions. Can’t be changed after saving.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'confirmed',
      index: true,
      options: [
        { label: 'Confirmed', value: 'confirmed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Confirmed holds a seat. Set to Cancelled to free the seat. Cancelling is final: a cancelled registration can’t be confirmed again.',
      },
    },
    {
      name: 'registeredAt',
      label: 'Registered at',
      type: 'date',
      access: { create: systemManaged, update: systemManaged },
      admin: {
        readOnly: true,
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Set automatically when the registration is created.',
      },
    },
    {
      name: 'cancelledAt',
      label: 'Cancelled at',
      type: 'date',
      access: { create: systemManaged, update: systemManaged },
      admin: {
        readOnly: true,
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Set automatically when the registration is cancelled.',
      },
    },
    {
      name: 'createdBy',
      label: 'Created by',
      type: 'relationship',
      relationTo: 'users',
      access: { create: systemManaged, update: systemManaged },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'The staff member who made the booking. Set automatically.',
      },
    },
  ],
}
