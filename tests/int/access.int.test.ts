import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { registerAttendee } from '@/services/registrations'

import { createAttendees, createOpenSession, createUsers, getTestPayload, loginToken, resetData, rest } from './helpers'

let payload: Payload
let users: Awaited<ReturnType<typeof createUsers>>
let adminToken: string
let staffToken: string
let sessionId: number
let registrationId: number
let attendeeId: number

beforeAll(async () => {
  payload = await getTestPayload()
  await resetData(payload)
  users = await createUsers(payload)
  adminToken = await loginToken(payload, 'admin@test.local', 'test-password-admin')
  staffToken = await loginToken(payload, 'staff@test.local', 'test-password-staff')
  const { session } = await createOpenSession(payload, { capacity: 10 })
  sessionId = session.id
  const [attendee] = await createAttendees(payload, 1)
  attendeeId = attendee.id
  registrationId = (await registerAttendee({ payload, attendeeId: attendee.id, sessionId })).id
})

afterAll(async () => {
  await resetData(payload)
  await payload.destroy()
})

const newEvent = {
  title: 'Staff should not create this',
  venue: 'Nowhere',
  startsAt: '2030-01-01T09:00:00.000Z',
  endsAt: '2030-01-01T17:00:00.000Z',
}

describe('staff is refused (403) where the role matrix says so', () => {
  it('cannot delete a registration', async () => {
    const res = await rest('DELETE', `/registrations/${registrationId}`, { token: staffToken })
    expect(res.status).toBe(403)
    expect(await payload.findByID({ collection: 'registrations', id: registrationId })).toBeTruthy()
  })

  it('cannot create an event', async () => {
    expect((await rest('POST', '/events', { token: staffToken, body: newEvent })).status).toBe(403)
  })

  it('cannot read other users: the list holds only their own record and another id is not found', async () => {
    const list = await rest('GET', '/users?depth=0', { token: staffToken })
    expect(list.status).toBe(200)
    expect(list.body.docs.map((u: { id: number }) => u.id)).toEqual([users.staff.id])
    expect((await rest('GET', `/users/${users.admin.id}`, { token: staffToken })).status).toBe(404)
  })

  it('cannot create users or change roles (including their own)', async () => {
    const created = await rest('POST', '/users', {
      token: staffToken,
      body: { email: 'x@test.local', password: 'whatever-password', name: 'X' },
    })
    expect(created.status).toBe(403)
    await rest('PATCH', `/users/${users.staff.id}`, { token: staffToken, body: { role: 'admin' } })
    expect((await payload.findByID({ collection: 'users', id: users.staff.id })).role).toBe('staff')
  })

  it('cannot change session capacity or delete sessions', async () => {
    expect((await rest('PATCH', `/sessions/${sessionId}`, { token: staffToken, body: { capacity: 99 } })).status).toBe(403)
    expect((await rest('DELETE', `/sessions/${sessionId}`, { token: staffToken })).status).toBe(403)
  })

  it('cannot delete attendees or upload media', async () => {
    expect((await rest('DELETE', `/attendees/${attendeeId}`, { token: staffToken })).status).toBe(403)
    expect((await rest('POST', '/media', { token: staffToken, body: { alt: 'x' } })).status).toBe(403)
  })

  it('anonymous requests get nothing', async () => {
    expect((await rest('GET', '/events')).status).toBe(403)
    expect((await rest('POST', '/registrations/cancel', { body: { ids: [registrationId] } })).status).toBe(401)
  })
})

describe('staff can do day-to-day work', () => {
  it('reads events and sessions, with seats left', async () => {
    const res = await rest('GET', `/sessions/${sessionId}?depth=0`, { token: staffToken })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ capacity: 10, seatsTaken: 1, seatsLeft: 9 })
  })

  it('creates and updates attendees', async () => {
    const created = await rest('POST', '/attendees', {
      token: staffToken,
      body: { fullName: 'Walk In', email: 'Walk.In@Test.Local ' },
    })
    expect(created.status).toBe(201)
    expect(created.body.doc.email).toBe('walk.in@test.local')
    const updated = await rest('PATCH', `/attendees/${created.body.doc.id}`, { token: staffToken, body: { company: 'ACME' } })
    expect(updated.status).toBe(200)
  })

  it('registers and cancels; rule violations come back as clean 400s', async () => {
    const [attendee] = await createAttendees(payload, 1)
    const created = await rest('POST', '/registrations', {
      token: staffToken,
      body: { attendee: attendee.id, session: sessionId },
    })
    expect(created.status).toBe(201)
    expect(created.body.doc.createdBy).toMatchObject({ id: users.staff.id })

    const duplicate = await rest('POST', '/registrations', {
      token: staffToken,
      body: { attendee: attendee.id, session: sessionId },
    })
    expect(duplicate.status).toBe(400)
    expect(duplicate.body.errors[0].message).toBe('Already registered for this session')

    const cancel = await rest('POST', '/registrations/cancel', { token: staffToken, body: { ids: [created.body.doc.id] } })
    expect(cancel).toEqual({ status: 200, body: { cancelled: 1, skipped: 0 } })
    const again = await rest('POST', '/registrations/cancel', { token: staffToken, body: { ids: [created.body.doc.id] } })
    expect(again.body).toEqual({ cancelled: 0, skipped: 1 })

    const reconfirm = await rest('PATCH', `/registrations/${created.body.doc.id}`, {
      token: adminToken,
      body: { status: 'confirmed' },
    })
    expect(reconfirm.status).toBe(403)
  })

  it('rejects an invalid cancel request body', async () => {
    expect((await rest('POST', '/registrations/cancel', { token: staffToken, body: { ids: [] } })).status).toBe(400)
    expect((await rest('POST', '/registrations/cancel', { token: staffToken, body: { ids: ['1; DROP'] } })).status).toBe(400)
  })
})

describe('admin can do what staff cannot', () => {
  it('creates events, reads all users, changes capacity and deletes registrations', async () => {
    expect((await rest('POST', '/events', { token: adminToken, body: newEvent })).status).toBe(201)
    const usersList = await rest('GET', '/users?depth=0', { token: adminToken })
    expect(usersList.body.totalDocs).toBe(2)
    expect((await rest('PATCH', `/sessions/${sessionId}`, { token: adminToken, body: { capacity: 20 } })).status).toBe(200)
    expect((await rest('DELETE', `/registrations/${registrationId}`, { token: adminToken })).status).toBe(200)
  })

  it('cannot change their own role, but can change someone else’s', async () => {
    await rest('PATCH', `/users/${users.admin.id}`, { token: adminToken, body: { role: 'staff' } })
    expect((await payload.findByID({ collection: 'users', id: users.admin.id })).role).toBe('admin')

    const res = await rest('PATCH', `/users/${users.staff.id}`, { token: adminToken, body: { role: 'admin' } })
    expect(res.status).toBe(200)
    expect((await payload.findByID({ collection: 'users', id: users.staff.id })).role).toBe('admin')
  })
})
