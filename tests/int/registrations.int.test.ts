import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MESSAGES } from '@/domain/registration'
import { mapDbError, type RuleViolationError } from '@/lib/errors'
import { cancelRegistrations, registerAttendee } from '@/services/registrations'

import {
  confirmedCount,
  createAttendees,
  createOpenSession,
  createUsers,
  getTestPayload,
  resetData,
} from './helpers'

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

const settle = async <T>(calls: Array<() => Promise<T>>) => Promise.allSettled(calls.map((call) => call()))
const rejections = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as RuleViolationError)
const rejectionMessages = (results: PromiseSettledResult<unknown>[]) => rejections(results).map((e) => e.message)

describe('capacity under concurrency (DB trigger)', () => {
  it('two concurrent registrations for the last seat: exactly one wins, 10 rounds', async () => {
    const sources = new Set<string>()
    for (let round = 0; round < 10; round++) {
      const { session } = await createOpenSession(payload, { capacity: 1 })
      const [a, b] = await createAttendees(payload, 2)
      const results = await settle([
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: session.id }),
        () => registerAttendee({ payload, attendeeId: b.id, sessionId: session.id }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(rejectionMessages(results)).toEqual(['Session is full'])
      sources.add(rejections(results)[0].source)
      expect(await confirmedCount(payload, session.id)).toBe(1)
    }
    expect(sources.has('database')).toBe(true)
  })

  it('12 parallel registrations for capacity 5: exactly 5 confirmed, 7 "Session is full"', async () => {
    for (let round = 0; round < 3; round++) {
      const { session } = await createOpenSession(payload, { capacity: 5 })
      const attendees = await createAttendees(payload, 12)
      const results = await settle(
        attendees.map((attendee) => () => registerAttendee({ payload, attendeeId: attendee.id, sessionId: session.id })),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
      expect(rejectionMessages(results)).toEqual(Array(7).fill('Session is full'))
      expect(rejections(results).some((e) => e.source === 'database')).toBe(true)
      expect(await confirmedCount(payload, session.id)).toBe(5)
    }
  })

  it('the trigger itself refuses an over-capacity insert that bypasses Payload', async () => {
    const { session } = await createOpenSession(payload, { capacity: 1 })
    const [a, b] = await createAttendees(payload, 2)
    await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    await expect(
      payload.db.drizzle.execute(
        sql`INSERT INTO registrations (attendee_id, session_id, status) VALUES (${b.id}, ${session.id}, 'confirmed')`,
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining('SESSION_FULL') } })
  })
})

describe('no duplicate confirmed registration (partial unique index)', () => {
  it('rejects a sequential duplicate with a clean message (domain check)', async () => {
    const { session } = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    await expect(registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })).rejects.toThrow(
      'Already registered for this session',
    )
  })

  it('racing duplicates: the unique index rejects the loser, mapped to the same message', async () => {
    for (let round = 0; round < 5; round++) {
      const { session } = await createOpenSession(payload, { capacity: 10 })
      const [a] = await createAttendees(payload, 1)
      const results = await settle([
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: session.id }),
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: session.id }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(rejectionMessages(results)).toEqual(['Already registered for this session'])
      expect(rejections(results)[0].source).toBe('database')
      expect(await confirmedCount(payload, session.id)).toBe(1)
    }
  })

  it('the index only covers confirmed rows: a cancelled row does not block re-registering', async () => {
    const { session } = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    const first = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    await cancelRegistrations({ payload, ids: [first.id] })
    const second = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    expect(second.id).not.toBe(first.id)

    await expect(
      payload.db.drizzle.execute(
        sql`INSERT INTO registrations (attendee_id, session_id, status) VALUES (${a.id}, ${session.id}, 'confirmed')`,
      ),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'registrations_one_confirmed_per_attendee_session' } })
  })
})

describe('no overlapping bookings under concurrency (DB trigger, attendee row lock)', () => {
  const HOUR = 60 * 60 * 1000
  async function eventWithSessions(offsetsMin: Array<[number, number]>) {
    const { event, session: first } = await createOpenSession(payload, { capacity: 50, durationHours: 1 })
    const base = Date.parse(first.startsAt)
    const others = []
    for (const [startMin, minutes] of offsetsMin) {
      others.push(
        await payload.create({
          collection: 'sessions',
          data: {
            event: event.id,
            title: `Session +${startMin}m`,
            startsAt: new Date(base + startMin * 60_000).toISOString(),
            endsAt: new Date(base + (startMin + minutes) * 60_000).toISOString(),
            capacity: 50,
          },
        }),
      )
    }
    return { event, first, others, base }
  }

  it('the same attendee racing into two overlapping sessions: exactly one wins, 10 rounds', async () => {
    const sources = new Set<string>()
    for (let round = 0; round < 10; round++) {
      const { first, others } = await eventWithSessions([[30, 60]])
      const [a] = await createAttendees(payload, 1)
      const results = await settle([
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: first.id }),
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: others[0].id }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const [rejected] = rejections(results)
      expect(rejected.code).toBe('SCHEDULE_CONFLICT')
      sources.add(rejected.source)
      const { totalDocs } = await payload.count({
        collection: 'registrations',
        where: { and: [{ attendee: { equals: a.id } }, { status: { equals: 'confirmed' } }] },
      })
      expect(totalDocs).toBe(1)
    }
    expect(sources.has('database')).toBe(true)
  })

  it('racing into back-to-back sessions: both succeed', async () => {
    for (let round = 0; round < 3; round++) {
      const { first, others } = await eventWithSessions([[60, 60]])
      const [a] = await createAttendees(payload, 1)
      const results = await settle([
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: first.id }),
        () => registerAttendee({ payload, attendeeId: a.id, sessionId: others[0].id }),
      ])
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    }
  })

  it('the trigger refuses an overlapping insert that bypasses Payload, and maps to the domain message', async () => {
    const { first, others } = await eventWithSessions([[30, 60]])
    const [a] = await createAttendees(payload, 1)
    await registerAttendee({ payload, attendeeId: a.id, sessionId: first.id })
    const error = await payload.db.drizzle
      .execute(sql`INSERT INTO registrations (attendee_id, session_id, status) VALUES (${a.id}, ${others[0].id}, 'confirmed')`)
      .then(() => null, (e: unknown) => e)
    expect(error).toMatchObject({ cause: { code: 'BR004', message: expect.stringContaining('ATTENDEE_OVERLAP') } })
    expect(mapDbError(error)).toMatchObject({ message: MESSAGES.SCHEDULE_CONFLICT, source: 'database' })
  })

  it('moving a session onto another booking of one of its attendees is refused; a free slot is fine', async () => {
    const { first, others, base } = await eventWithSessions([[120, 60]])
    const [a] = await createAttendees(payload, 1)
    await registerAttendee({ payload, attendeeId: a.id, sessionId: first.id })
    await registerAttendee({ payload, attendeeId: a.id, sessionId: others[0].id })

    const moveOnto = payload.update({
      collection: 'sessions',
      id: others[0].id,
      data: { startsAt: new Date(base + 30 * 60_000).toISOString(), endsAt: new Date(base + 90 * 60_000).toISOString() },
    })
    const error = await moveOnto.then(() => null, (e: unknown) => e)
    expect(mapDbError(error)).toMatchObject({ code: 'SESSION_TIME_CONFLICT', source: 'database' })

    const moved = await payload.update({
      collection: 'sessions',
      id: others[0].id,
      data: { startsAt: new Date(base + 1 * HOUR).toISOString(), endsAt: new Date(base + 2 * HOUR).toISOString() },
    })
    expect(moved.startsAt).toBe(new Date(base + HOUR).toISOString())
  })
})

describe('cancelRegistrations', () => {
  it('is idempotent: the second run cancels nothing and seats are freed once', async () => {
    const { session } = await createOpenSession(payload, { capacity: 3 })
    const attendees = await createAttendees(payload, 3)
    const regs = []
    for (const attendee of attendees) {
      regs.push(await registerAttendee({ payload, attendeeId: attendee.id, sessionId: session.id }))
    }
    const seatsLeft = async () =>
      (await payload.findByID({ collection: 'sessions', id: session.id, depth: 0 })).seatsLeft
    expect(await seatsLeft()).toBe(0)

    const ids = [regs[0].id, regs[1].id]
    const first = await cancelRegistrations({ payload, ids })
    expect(first).toMatchObject({ cancelled: 2, skipped: 0 })
    expect(await seatsLeft()).toBe(2)

    const second = await cancelRegistrations({ payload, ids })
    expect(second).toMatchObject({ cancelled: 0, skipped: 2 })
    expect(await seatsLeft()).toBe(2)

    const cancelled = await payload.findByID({ collection: 'registrations', id: regs[0].id, depth: 0 })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.cancelledAt).toBeTruthy()
  })

  it('mixed batch: counts already-cancelled and unknown ids as skipped', async () => {
    const { session } = await createOpenSession(payload)
    const [a, b] = await createAttendees(payload, 2)
    const ra = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })
    const rb = await registerAttendee({ payload, attendeeId: b.id, sessionId: session.id })
    await cancelRegistrations({ payload, ids: [ra.id] })
    expect(await cancelRegistrations({ payload, ids: [ra.id, rb.id, 999999] })).toMatchObject({ cancelled: 1, skipped: 2 })
  })
})

describe('other rules through Payload', () => {
  it('capacity floor: lowering capacity below confirmed count is refused (hook and trigger)', async () => {
    const { session } = await createOpenSession(payload, { capacity: 5 })
    const attendees = await createAttendees(payload, 3)
    for (const attendee of attendees) await registerAttendee({ payload, attendeeId: attendee.id, sessionId: session.id })

    await expect(payload.update({ collection: 'sessions', id: session.id, data: { capacity: 2 } })).rejects.toThrow(
      /The following field is invalid: capacity|Capacity can't be lower/,
    )
    const updated = await payload.update({ collection: 'sessions', id: session.id, data: { capacity: 3 } })
    expect(updated.capacity).toBe(3)

    await expect(payload.db.drizzle.execute(sql`UPDATE sessions SET capacity = 1 WHERE id = ${session.id}`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('CAPACITY_BELOW_CONFIRMED') },
    })
  })

  it('open events only: refuses draft events and ended sessions', async () => {
    const draft = await createOpenSession(payload, { status: 'draft' as never })
    const ended = await createOpenSession(payload, { startOffsetHours: -3 })
    const [a] = await createAttendees(payload, 1)
    await expect(registerAttendee({ payload, attendeeId: a.id, sessionId: draft.session.id })).rejects.toThrow(
      /event is not published yet/,
    )
    await expect(registerAttendee({ payload, attendeeId: a.id, sessionId: ended.session.id })).rejects.toThrow(
      /session has already ended/,
    )
  })

  it('no overlap: refuses overlapping sessions, allows back-to-back ones', async () => {
    const { event, session: first } = await createOpenSession(payload, { capacity: 10, durationHours: 1 })
    const make = (startOffsetMin: number, minutes: number) =>
      payload.create({
        collection: 'sessions',
        data: {
          event: event.id,
          title: `S+${startOffsetMin}`,
          startsAt: new Date(Date.parse(first.startsAt) + startOffsetMin * 60_000).toISOString(),
          endsAt: new Date(Date.parse(first.startsAt) + (startOffsetMin + minutes) * 60_000).toISOString(),
          capacity: 10,
        },
      })
    const overlapping = await make(30, 60)
    const backToBack = await make(60, 60)
    const [a] = await createAttendees(payload, 1)
    await registerAttendee({ payload, attendeeId: a.id, sessionId: first.id })
    await expect(registerAttendee({ payload, attendeeId: a.id, sessionId: overlapping.id })).rejects.toThrow(
      /overlapping time/,
    )
    await expect(registerAttendee({ payload, attendeeId: a.id, sessionId: backToBack.id })).resolves.toBeTruthy()
  })

  it('cancel is one-way and attendee/session cannot change', async () => {
    const { session } = await createOpenSession(payload)
    const other = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    const reg = await registerAttendee({ payload, attendeeId: a.id, sessionId: session.id })

    await expect(
      payload.update({ collection: 'registrations', id: reg.id, data: { session: other.session.id } }),
    ).rejects.toThrow(/can’t be changed/)

    await cancelRegistrations({ payload, ids: [reg.id] })
    await expect(
      payload.update({ collection: 'registrations', id: reg.id, data: { status: 'confirmed' } }),
    ).rejects.toThrow(/Cancelled registrations can’t be changed/)

    await expect(
      payload.db.drizzle.execute(sql`UPDATE registrations SET status = 'confirmed' WHERE id = ${reg.id}`),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining('REGISTRATION_CANCELLED') } })
  })

  it('session must lie inside its event; event dates cannot strand sessions', async () => {
    const { event, session } = await createOpenSession(payload)
    await expect(
      payload.update({
        collection: 'sessions',
        id: session.id,
        data: { endsAt: new Date(Date.parse(event.endsAt) + 60_000).toISOString() },
      }),
    ).rejects.toThrow(/startsAt|within the event/)
    await expect(
      payload.update({ collection: 'events', id: event.id, data: { endsAt: session.startsAt } }),
    ).rejects.toThrow(/startsAt|outside the event/)
  })

  it('sets registeredAt, createdBy and the label automatically', async () => {
    const { event, session } = await createOpenSession(payload)
    const [a] = await createAttendees(payload, 1)
    const users = await payload.find({ collection: 'users', where: { role: { equals: 'staff' } } })
    const staff = { ...users.docs[0], collection: 'users' as const }
    const reg = await payload.create({
      collection: 'registrations',
      data: { attendee: a.id, session: session.id, registeredAt: '2000-01-01T00:00:00Z' } as never,
      user: staff,
      overrideAccess: false,
      depth: 0,
    })
    expect(reg.createdBy).toBe(staff.id)
    expect(Date.parse(reg.registeredAt!)).toBeGreaterThan(Date.now() - 60_000)
    expect(reg.label).toBe(`${a.fullName} → Test session — ${event.title}`)
  })
})
