import type { SanitizedCollectionPermission } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildFormContext, renderFormContext } from '@/ai/fieldContext'
import { Registrations } from '@/collections/Registrations'
import { Sessions } from '@/collections/Sessions'
import { Users } from '@/collections/Users'

const readOnly = { read: true } as const
const readWrite = { read: true, create: true, update: true } as const

const staffSessions = {
  read: true,
  fields: {
    event: readOnly,
    title: readOnly,
    room: readOnly,
    startsAt: readOnly,
    endsAt: readOnly,
    capacity: readOnly,
    seatsTaken: readOnly,
    seatsLeft: readOnly,
    registrations: readOnly,
  },
} as unknown as SanitizedCollectionPermission

const adminSessions = { read: true, create: true, update: true, delete: true, fields: true } as unknown as SanitizedCollectionPermission

describe('buildFormContext', () => {
  it('returns null when the user cannot read the collection', () => {
    expect(buildFormContext(Users, undefined)).toBeNull()
    expect(buildFormContext(Users, { fields: {} } as unknown as SanitizedCollectionPermission)).toBeNull()
  })

  it('includes field descriptions, labels, types, requiredness and limits from the config', () => {
    const context = buildFormContext(Sessions, adminSessions)!
    const capacity = context.fields.find((f) => f.name === 'capacity')!
    expect(capacity).toMatchObject({ type: 'number', required: true, min: 1, editable: true })
    expect(capacity.description).toMatch(/cannot be set lower than the number already confirmed/)
    const startsAt = context.fields.find((f) => f.name === 'startsAt')!
    expect(startsAt.label).toBe('Starts at')
    expect(context.fields.find((f) => f.name === 'event')?.relatesTo).toBe('events')
  })

  it('flattens rows and marks virtual fields as calculated and read-only', () => {
    const context = buildFormContext(Sessions, adminSessions)!
    const seatsLeft = context.fields.find((f) => f.name === 'seatsLeft')!
    expect(seatsLeft).toMatchObject({ calculated: true, editable: false })
  })

  it('reflects the role: staff see the same fields but nothing is editable for them', () => {
    const context = buildFormContext(Sessions, staffSessions)!
    expect(context.permissions).toEqual({ create: false, update: false, delete: false })
    expect(context.fields.every((f) => f.editable === false)).toBe(true)
    expect(renderFormContext(context)).toContain('This user can: only view records here.')
  })

  it('drops fields the user cannot read', () => {
    const limited = { read: true, fields: { title: readOnly } } as unknown as SanitizedCollectionPermission
    const context = buildFormContext(Sessions, limited)!
    expect(context.fields.map((f) => f.name)).toEqual(['title'])
  })

  it('treats where-based access ({ permission: true, where }) as allowed', () => {
    const staffRegistrations = {
      read: true,
      create: true,
      update: { permission: true, where: { status: { equals: 'confirmed' } } },
      fields: { status: { read: { permission: true }, update: { permission: true, where: {} } } },
    } as unknown as SanitizedCollectionPermission
    const context = buildFormContext(Registrations, staffRegistrations)!
    expect(context.permissions).toEqual({ create: true, update: true, delete: false })
    expect(context.fields.find((f) => f.name === 'status')?.editable).toBe(true)

    const ownUserOnly = { read: { permission: true, where: { id: { equals: 2 } } }, fields: true } as unknown as SanitizedCollectionPermission
    expect(buildFormContext(Users, ownUserOnly)).not.toBeNull()
    expect(buildFormContext(Users, { read: { permission: false }, fields: {} } as unknown as SanitizedCollectionPermission)).toBeNull()
  })

  it('lists select options and the collection rules', () => {
    const permissions = {
      read: true,
      create: true,
      update: true,
      fields: { label: readOnly, attendee: readWrite, session: readWrite, status: readWrite, registeredAt: readOnly },
    } as unknown as SanitizedCollectionPermission
    const context = buildFormContext(Registrations, permissions)!
    expect(context.fields.find((f) => f.name === 'status')?.options).toEqual(['confirmed (Confirmed)', 'cancelled (Cancelled)'])
    expect(context.fields.find((f) => f.name === 'registeredAt')?.editable).toBe(false)
    const text = renderFormContext(context)
    expect(text).toContain('Session is full')
    expect(text).toContain('Cancelling is one-way')
    expect(text).toContain('Registered at [registeredAt; date; optional; read-only for this user]')
  })
})
