import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { registerAttendee } from '@/services/registrations'

import { createAttendees, createOpenSession, createUsers, getTestPayload, loginToken, resetData, rest } from './helpers'

let payload: Payload

beforeAll(async () => {
  payload = await getTestPayload()
})

beforeEach(async () => {
  await resetData(payload)
  await createUsers(payload)
})

afterAll(async () => {
  await resetData(payload)
  await payload.destroy()
})

const labelOf = async (id: number) => (await payload.findByID({ collection: 'registrations', id, depth: 0 })).label
const displayTitleOf = async (id: number) => (await payload.findByID({ collection: 'sessions', id, depth: 0 })).displayTitle

describe('session display title and registration labels', () => {
  it('a session is shown as "Session — Event"; its registrations as "Attendee → Session — Event"', async () => {
    const { event, session } = await createOpenSession(payload)
    expect(session.displayTitle).toBe(`Test session — ${event.title}`)
    const [a] = await createAttendees(payload, 1)
    const reg = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    expect(reg.label).toBe(`${a.fullName} → Test session — ${event.title}`)
  })

  it('renaming the event updates its sessions and their registrations', async () => {
    const { event, session } = await createOpenSession(payload)
    const other = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    const reg = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })

    await payload.update({ collection: 'events', id: event.id, data: { title: 'Renamed Summit' } })
    expect(await displayTitleOf(session.id)).toBe('Test session — Renamed Summit')
    expect(await labelOf(reg.id)).toBe(`${a.fullName} → Test session — Renamed Summit`)
    expect(await displayTitleOf(other.session.id)).toBe(`Test session — ${other.event.title}`)
  })

  it('renaming the session or the attendee updates the labels', async () => {
    const { event, session } = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    const reg = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })

    await payload.update({ collection: 'sessions', id: session.id, data: { title: 'Closing panel' } })
    expect(await displayTitleOf(session.id)).toBe(`Closing panel — ${event.title}`)
    expect(await labelOf(reg.id)).toBe(`${a.fullName} → Closing panel — ${event.title}`)

    await payload.update({ collection: 'attendees', id: a.id, data: { fullName: 'Grace Hopper' } })
    expect(await labelOf(reg.id)).toBe(`Grace Hopper → Closing panel — ${event.title}`)
  })

  it('a rename that fails validation rolls the label updates back with it', async () => {
    const { event, session } = await createOpenSession(payload)
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { title: 'Broken', endsAt: session.startsAt } }),
    ).rejects.toThrow()
    expect(await displayTitleOf(session.id)).toBe(`Test session — ${event.title}`)
  })

  it('clients cannot write the stored titles', async () => {
    const { event, session } = await createOpenSession(payload)
    const token = await loginToken(payload, 'admin@test.local', 'test-password-admin')
    const res = await rest('PATCH', `/sessions/${session.id}`, { token, body: { displayTitle: 'Hacked', room: 'Hall Z' } })
    expect(res.status).toBe(200)
    expect(await displayTitleOf(session.id)).toBe(`Test session — ${event.title}`)
  })

  it('list columns for names are resolved on the server (no client-side relationship lookups)', async () => {
    const { event, session } = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    const token = await loginToken(payload, 'staff@test.local', 'test-password-staff')

    const regs = await rest('GET', '/registrations?depth=0', { token })
    expect(regs.body.docs[0]).toMatchObject({
      attendee: a.id,
      attendeeName: a.fullName,
      sessionName: `Test session — ${event.title}`,
    })
    const byEmail = await rest('GET', `/registrations?depth=0&where[attendeeEmail][like]=${encodeURIComponent(a.email)}`, { token })
    expect(byEmail.status).toBe(200)
    expect(byEmail.body.totalDocs).toBe(1)
    const sessions = await rest('GET', `/sessions/${session.id}?depth=0`, { token })
    expect(sessions.body).toMatchObject({ event: event.id, eventTitle: event.title })
  })
})
