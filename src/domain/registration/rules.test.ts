import { describe, expect, it } from 'vitest'

import {
  checkCapacity,
  checkCapacityFloor,
  checkCapacityValue,
  checkEventStillContainsSessions,
  checkInitialStatus,
  checkNoDuplicate,
  checkNoOverlap,
  checkRegistrationOpen,
  checkRegistrationUpdate,
  checkSessionWithinEvent,
  checkTimeRange,
  MESSAGES,
  planCancellation,
  rangesOverlap,
  toMillis,
  validateNewRegistration,
  type NewRegistrationInput,
} from './index'

const at = (iso: string) => new Date(iso)
const codeOf = (result: { ok: boolean; code?: string }) => (result.ok ? 'OK' : result.code)

describe('time helpers', () => {
  it('compares instants across time zones by absolute time', () => {
    expect(toMillis('2026-03-01T09:00:00+01:00')).toBe(toMillis('2026-03-01T08:00:00Z'))
    expect(toMillis(at('2026-03-01T08:00:00Z'))).toBe(toMillis('2026-03-01T08:00:00.000Z'))
  })

  it('treats ranges as half-open: touching ranges do not overlap', () => {
    const a = { startsAt: '2026-03-01T09:00:00Z', endsAt: '2026-03-01T10:00:00Z' }
    const b = { startsAt: '2026-03-01T10:00:00Z', endsAt: '2026-03-01T11:00:00Z' }
    expect(rangesOverlap(a, b)).toBe(false)
    expect(rangesOverlap(b, a)).toBe(false)
  })

  it('detects touching ranges written in different offsets', () => {
    const a = { startsAt: '2026-03-01T09:00:00Z', endsAt: '2026-03-01T10:00:00Z' }
    const b = { startsAt: '2026-03-01T11:00:00+01:00', endsAt: '2026-03-01T12:00:00+01:00' } // 10:00Z–11:00Z
    expect(rangesOverlap(a, b)).toBe(false)
    const c = { startsAt: '2026-03-01T10:59:00+01:00', endsAt: '2026-03-01T12:00:00+01:00' } // 09:59Z
    expect(rangesOverlap(a, c)).toBe(true)
  })
})

describe('checkTimeRange', () => {
  it('accepts end after start', () => {
    expect(checkTimeRange({ startsAt: '2026-01-01T09:00:00Z', endsAt: '2026-01-01T09:00:01Z' }).ok).toBe(true)
  })
  it('rejects end equal to start and end before start', () => {
    expect(codeOf(checkTimeRange({ startsAt: '2026-01-01T09:00:00Z', endsAt: '2026-01-01T09:00:00Z' }))).toBe(
      'INVALID_TIME_RANGE',
    )
    expect(codeOf(checkTimeRange({ startsAt: '2026-01-01T09:00:00Z', endsAt: '2026-01-01T08:00:00Z' }))).toBe(
      'INVALID_TIME_RANGE',
    )
  })
  it('rejects missing or unparseable dates', () => {
    expect(codeOf(checkTimeRange({ startsAt: '2026-01-01T09:00:00Z' }))).toBe('INVALID_DATE')
    expect(codeOf(checkTimeRange({ startsAt: 'not a date', endsAt: '2026-01-01T09:00:00Z' }))).toBe('INVALID_DATE')
  })
})

describe('rule 5: session inside its event', () => {
  const event = { startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z' }
  it('accepts a session inside the event, including exactly on the boundaries', () => {
    expect(checkSessionWithinEvent({ startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z' }, event).ok).toBe(true)
    expect(checkSessionWithinEvent({ startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T11:00:00Z' }, event).ok).toBe(true)
  })
  it('rejects a session that starts before or ends after the event', () => {
    expect(codeOf(checkSessionWithinEvent({ startsAt: '2026-05-01T07:59:59Z', endsAt: '2026-05-01T09:00:00Z' }, event))).toBe(
      'SESSION_OUTSIDE_EVENT',
    )
    expect(codeOf(checkSessionWithinEvent({ startsAt: '2026-05-02T17:00:00Z', endsAt: '2026-05-02T18:00:01Z' }, event))).toBe(
      'SESSION_OUTSIDE_EVENT',
    )
  })
  it('checks the session range itself first', () => {
    expect(codeOf(checkSessionWithinEvent({ startsAt: '2026-05-01T11:00:00Z', endsAt: '2026-05-01T10:00:00Z' }, event))).toBe(
      'INVALID_TIME_RANGE',
    )
  })
  it('compares in absolute time (offset-written event, UTC session)', () => {
    const offsetEvent = { startsAt: '2026-05-01T10:00:00+02:00', endsAt: '2026-05-01T20:00:00+02:00' } // 08:00Z–18:00Z
    expect(checkSessionWithinEvent({ startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-01T09:00:00Z' }, offsetEvent).ok).toBe(true)
  })
  it('refuses event date changes that would strand sessions', () => {
    const sessions = [
      { title: 'Keynote', startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T10:00:00Z' },
      { title: 'Closing', startsAt: '2026-05-02T16:00:00Z', endsAt: '2026-05-02T17:00:00Z' },
    ]
    expect(checkEventStillContainsSessions(event, sessions).ok).toBe(true)
    const shorter = { startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-01T18:00:00Z' }
    const result = checkEventStillContainsSessions(shorter, sessions)
    expect(codeOf(result)).toBe('EVENT_WOULD_EXCLUDE_SESSIONS')
    expect(result.ok ? '' : result.message).toContain('"Closing"')
  })
})

describe('rule 1: capacity', () => {
  it('allows the last seat and refuses one more', () => {
    expect(checkCapacity({ capacity: 10, confirmedCount: 9 }).ok).toBe(true)
    const full = checkCapacity({ capacity: 10, confirmedCount: 10 })
    expect(full).toEqual({ ok: false, code: 'SESSION_FULL', message: MESSAGES.SESSION_FULL })
  })
  it('refuses when already over capacity (defensive)', () => {
    expect(codeOf(checkCapacity({ capacity: 1, confirmedCount: 3 }))).toBe('SESSION_FULL')
  })
  it('validates capacity values: whole numbers ≥ 1', () => {
    expect(checkCapacityValue(1).ok).toBe(true)
    for (const bad of [0, -1, 1.5, Number.NaN, '10', null, undefined]) {
      expect(codeOf(checkCapacityValue(bad))).toBe('INVALID_CAPACITY')
    }
  })
})

describe('rule 4: capacity floor', () => {
  it('allows lowering capacity down to exactly the confirmed count', () => {
    expect(checkCapacityFloor({ newCapacity: 5, confirmedCount: 5 }).ok).toBe(true)
  })
  it('refuses lowering below the confirmed count', () => {
    const result = checkCapacityFloor({ newCapacity: 4, confirmedCount: 5 })
    expect(codeOf(result)).toBe('CAPACITY_BELOW_CONFIRMED')
    expect(result.ok ? '' : result.message).toContain('5 confirmed')
  })
  it('still requires a valid capacity', () => {
    expect(codeOf(checkCapacityFloor({ newCapacity: 0, confirmedCount: 0 }))).toBe('INVALID_CAPACITY')
  })
})

describe('rule 2: no overlapping confirmed sessions', () => {
  const booked = [{ sessionId: 1, title: 'Morning talk', startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T10:00:00Z' }]
  it('refuses a session that overlaps an existing booking', () => {
    const result = checkNoOverlap({ sessionId: 2, startsAt: '2026-05-01T09:30:00Z', endsAt: '2026-05-01T10:30:00Z' }, booked)
    expect(codeOf(result)).toBe('SCHEDULE_CONFLICT')
    expect(result.ok ? '' : result.message).toContain('"Morning talk"')
  })
  it('refuses a session fully inside or fully around a booking', () => {
    expect(codeOf(checkNoOverlap({ sessionId: 2, startsAt: '2026-05-01T09:15:00Z', endsAt: '2026-05-01T09:45:00Z' }, booked))).toBe(
      'SCHEDULE_CONFLICT',
    )
    expect(codeOf(checkNoOverlap({ sessionId: 2, startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-01T11:00:00Z' }, booked))).toBe(
      'SCHEDULE_CONFLICT',
    )
  })
  it('allows back-to-back sessions (end == start) on either side', () => {
    expect(checkNoOverlap({ sessionId: 2, startsAt: '2026-05-01T10:00:00Z', endsAt: '2026-05-01T11:00:00Z' }, booked).ok).toBe(true)
    expect(checkNoOverlap({ sessionId: 3, startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-01T09:00:00Z' }, booked).ok).toBe(true)
  })
  it('only considers the bookings it is given (cancelled ones are excluded by the caller)', () => {
    expect(checkNoOverlap({ sessionId: 2, startsAt: '2026-05-01T09:30:00Z', endsAt: '2026-05-01T10:30:00Z' }, []).ok).toBe(true)
  })
})

describe('rule 3: open events only', () => {
  const now = at('2026-05-01T12:00:00Z')
  it('accepts a published event with a session that has not ended', () => {
    expect(checkRegistrationOpen({ eventStatus: 'published', sessionEndsAt: '2026-05-01T12:00:01Z', now }).ok).toBe(true)
  })
  it('accepts a session that is in progress', () => {
    expect(checkRegistrationOpen({ eventStatus: 'published', sessionEndsAt: '2026-05-01T13:00:00Z', now }).ok).toBe(true)
  })
  it('refuses draft and cancelled events', () => {
    expect(codeOf(checkRegistrationOpen({ eventStatus: 'draft', sessionEndsAt: '2026-06-01T00:00:00Z', now }))).toBe('EVENT_NOT_OPEN')
    expect(codeOf(checkRegistrationOpen({ eventStatus: 'cancelled', sessionEndsAt: '2026-06-01T00:00:00Z', now }))).toBe(
      'EVENT_NOT_OPEN',
    )
  })
  it('refuses a session that ended, including one ending exactly now', () => {
    expect(codeOf(checkRegistrationOpen({ eventStatus: 'published', sessionEndsAt: '2026-05-01T11:00:00Z', now }))).toBe('SESSION_ENDED')
    expect(codeOf(checkRegistrationOpen({ eventStatus: 'published', sessionEndsAt: '2026-05-01T12:00:00Z', now }))).toBe('SESSION_ENDED')
  })
})

describe('rule 7: no duplicate confirmed registration', () => {
  it('refuses a second confirmed registration for the same session (ids compared as strings)', () => {
    expect(checkNoDuplicate(5, [{ sessionId: '5' }])).toEqual({
      ok: false,
      code: 'ALREADY_REGISTERED',
      message: MESSAGES.ALREADY_REGISTERED,
    })
  })
  it('allows other sessions', () => {
    expect(checkNoDuplicate(5, [{ sessionId: 6 }]).ok).toBe(true)
  })
})

describe('validateNewRegistration (rules 1, 2, 3, 7 together)', () => {
  const base: NewRegistrationInput = {
    now: at('2026-05-01T08:00:00Z'),
    event: { status: 'published' },
    session: { id: 10, startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T10:00:00Z', capacity: 2, confirmedCount: 0 },
    attendeeBookings: [],
  }
  it('passes when every rule passes', () => {
    expect(validateNewRegistration(base).ok).toBe(true)
  })
  it('reports a closed event before anything else', () => {
    expect(codeOf(validateNewRegistration({ ...base, event: { status: 'draft' }, session: { ...base.session, confirmedCount: 2 } }))).toBe(
      'EVENT_NOT_OPEN',
    )
  })
  it('reports a duplicate before "full"', () => {
    const input = {
      ...base,
      session: { ...base.session, confirmedCount: 2 },
      attendeeBookings: [{ sessionId: 10, startsAt: base.session.startsAt, endsAt: base.session.endsAt }],
    }
    expect(codeOf(validateNewRegistration(input))).toBe('ALREADY_REGISTERED')
  })
  it('reports a full session', () => {
    expect(codeOf(validateNewRegistration({ ...base, session: { ...base.session, confirmedCount: 2 } }))).toBe('SESSION_FULL')
  })
  it('reports an overlap with another confirmed booking', () => {
    const input = {
      ...base,
      attendeeBookings: [{ sessionId: 11, startsAt: '2026-05-01T09:30:00Z', endsAt: '2026-05-01T10:30:00Z' }],
    }
    expect(codeOf(validateNewRegistration(input))).toBe('SCHEDULE_CONFLICT')
  })
})

describe('rule 6: cancel is one-way, attendee/session are fixed', () => {
  const confirmed = { attendeeId: 1, sessionId: 2, status: 'confirmed' as const }
  it('allows confirmed → cancelled and a no-op save', () => {
    expect(checkRegistrationUpdate(confirmed, { ...confirmed, status: 'cancelled' }).ok).toBe(true)
    expect(checkRegistrationUpdate(confirmed, confirmed).ok).toBe(true)
  })
  it('refuses any change to a cancelled registration, including re-confirming', () => {
    const cancelled = { ...confirmed, status: 'cancelled' as const }
    expect(codeOf(checkRegistrationUpdate(cancelled, confirmed))).toBe('REGISTRATION_CANCELLED')
    expect(codeOf(checkRegistrationUpdate(cancelled, cancelled))).toBe('REGISTRATION_CANCELLED')
  })
  it('refuses changing attendee or session', () => {
    expect(codeOf(checkRegistrationUpdate(confirmed, { ...confirmed, sessionId: 3 }))).toBe('REGISTRATION_IMMUTABLE')
    expect(codeOf(checkRegistrationUpdate(confirmed, { ...confirmed, attendeeId: 9 }))).toBe('REGISTRATION_IMMUTABLE')
  })
  it('treats numeric and string ids as the same id', () => {
    expect(checkRegistrationUpdate(confirmed, { attendeeId: '1', sessionId: '2', status: 'confirmed' }).ok).toBe(true)
  })
  it('new registrations always start confirmed', () => {
    expect(checkInitialStatus(undefined).ok).toBe(true)
    expect(checkInitialStatus('confirmed').ok).toBe(true)
    expect(codeOf(checkInitialStatus('cancelled'))).toBe('INVALID_STATUS_TRANSITION')
  })
})

describe('planCancellation (idempotent bulk cancel)', () => {
  it('only cancels rows that are still confirmed', () => {
    const rows = [
      { id: 1, status: 'confirmed' },
      { id: 2, status: 'cancelled' },
      { id: 3, status: 'confirmed' },
    ]
    const plan = planCancellation(rows)
    expect(plan.toCancel.map((r) => r.id)).toEqual([1, 3])
    expect(plan.skipped).toBe(1)
  })
  it('cancels nothing the second time', () => {
    const plan = planCancellation([
      { id: 1, status: 'cancelled' },
      { id: 3, status: 'cancelled' },
    ])
    expect(plan.toCancel).toHaveLength(0)
    expect(plan.skipped).toBe(2)
  })
})
