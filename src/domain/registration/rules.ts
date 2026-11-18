import { isValidInstant, rangeContains, rangesOverlap, toMillis } from './time'
import {
  fail,
  OK,
  type EventStatus,
  type ID,
  type Instant,
  type RegistrationStatus,
  type RuleResult,
  type TimeRange,
} from './types'

export const MESSAGES = {
  SESSION_FULL: 'Session is full',
  ALREADY_REGISTERED: 'Already registered for this session',
  SCHEDULE_CONFLICT: 'This attendee is already booked into another session at an overlapping time.',
  SESSION_TIME_CONFLICT:
    'These times would overlap another session that someone booked here is already confirmed for. Cancel one of the bookings first.',
} as const

export const IMMUTABLE_MESSAGE =
  'The attendee and session of a registration can’t be changed. Cancel it and create a new one.'

const sameId = (a: ID, b: ID) => String(a) === String(b)

export function checkTimeRange(range: Partial<TimeRange>, what = 'This item'): RuleResult {
  if (!isValidInstant(range.startsAt) || !isValidInstant(range.endsAt)) {
    return fail('INVALID_DATE', `${what} needs a valid start and end date/time.`)
  }
  if (toMillis(range.endsAt) <= toMillis(range.startsAt)) {
    return fail('INVALID_TIME_RANGE', `${what} must end after it starts.`)
  }
  return OK
}

export function checkSessionWithinEvent(session: TimeRange, event: TimeRange): RuleResult {
  const range = checkTimeRange(session, 'The session')
  if (!range.ok) return range
  if (!rangeContains(event, session)) {
    return fail(
      'SESSION_OUTSIDE_EVENT',
      'The session must start and end within the event dates. Adjust the session times or the event dates.',
    )
  }
  return OK
}

export function checkEventStillContainsSessions(
  event: TimeRange,
  sessions: Array<TimeRange & { title?: string }>,
): RuleResult {
  const outside = sessions.filter((session) => !rangeContains(event, session))
  if (outside.length === 0) return OK
  const names = outside
    .slice(0, 3)
    .map((s) => (s.title ? `"${s.title}"` : 'a session'))
    .join(', ')
  return fail(
    'EVENT_WOULD_EXCLUDE_SESSIONS',
    `These dates would leave ${outside.length} session(s) outside the event (${names}${
      outside.length > 3 ? ', …' : ''
    }). Move those sessions first.`,
  )
}

export function checkCapacityValue(capacity: unknown): RuleResult {
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1) {
    return fail('INVALID_CAPACITY', 'Capacity must be a whole number of at least 1.')
  }
  return OK
}

export function checkCapacity(input: { capacity: number; confirmedCount: number }): RuleResult {
  if (input.confirmedCount >= input.capacity) return fail('SESSION_FULL', MESSAGES.SESSION_FULL)
  return OK
}

export function checkCapacityFloor(input: { newCapacity: number; confirmedCount: number }): RuleResult {
  const value = checkCapacityValue(input.newCapacity)
  if (!value.ok) return value
  if (input.newCapacity < input.confirmedCount) {
    return fail(
      'CAPACITY_BELOW_CONFIRMED',
      `Capacity can't be lower than the ${input.confirmedCount} confirmed registration(s). Cancel registrations first or choose at least ${input.confirmedCount}.`,
    )
  }
  return OK
}

export type ConfirmedBooking = TimeRange & { sessionId: ID; title?: string }

export function checkNoOverlap(target: TimeRange & { sessionId: ID }, existing: ConfirmedBooking[]): RuleResult {
  const clash = existing.find(
    (booking) => !sameId(booking.sessionId, target.sessionId) && rangesOverlap(booking, target),
  )
  if (!clash) return OK
  return fail(
    'SCHEDULE_CONFLICT',
    clash.title
      ? `This attendee is already booked into "${clash.title}" at an overlapping time.`
      : MESSAGES.SCHEDULE_CONFLICT,
  )
}

export function checkRegistrationOpen(input: {
  eventStatus: EventStatus | string | null | undefined
  sessionEndsAt: Instant
  now: Instant
}): RuleResult {
  if (input.eventStatus !== 'published') {
    const state = input.eventStatus === 'cancelled' ? 'cancelled' : 'not published yet'
    return fail('EVENT_NOT_OPEN', `Registrations are closed: the event is ${state}.`)
  }
  if (toMillis(input.sessionEndsAt) <= toMillis(input.now)) {
    return fail('SESSION_ENDED', 'Registrations are closed: this session has already ended.')
  }
  return OK
}

export function checkNoDuplicate(sessionId: ID, existing: Array<{ sessionId: ID }>): RuleResult {
  if (existing.some((booking) => sameId(booking.sessionId, sessionId))) {
    return fail('ALREADY_REGISTERED', MESSAGES.ALREADY_REGISTERED)
  }
  return OK
}

export type NewRegistrationInput = {
  now: Instant
  event: { status: EventStatus | string | null | undefined }
  session: TimeRange & { id: ID; capacity: number; confirmedCount: number }
  attendeeBookings: ConfirmedBooking[]
}

export function validateNewRegistration(input: NewRegistrationInput): RuleResult {
  const checks: Array<() => RuleResult> = [
    () =>
      checkRegistrationOpen({
        eventStatus: input.event.status,
        sessionEndsAt: input.session.endsAt,
        now: input.now,
      }),
    () => checkNoDuplicate(input.session.id, input.attendeeBookings),
    () => checkCapacity(input.session),
    () => checkNoOverlap({ ...input.session, sessionId: input.session.id }, input.attendeeBookings),
  ]
  for (const check of checks) {
    const result = check()
    if (!result.ok) return result
  }
  return OK
}

export type RegistrationSnapshot = {
  attendeeId: ID
  sessionId: ID
  status: RegistrationStatus
}

export function checkRegistrationUpdate(previous: RegistrationSnapshot, next: RegistrationSnapshot): RuleResult {
  if (previous.status === 'cancelled') {
    return fail(
      'REGISTRATION_CANCELLED',
      'Cancelled registrations can’t be changed. Create a new registration instead.',
    )
  }
  if (!sameId(previous.attendeeId, next.attendeeId) || !sameId(previous.sessionId, next.sessionId)) {
    return fail('REGISTRATION_IMMUTABLE', IMMUTABLE_MESSAGE)
  }
  if (next.status !== 'confirmed' && next.status !== 'cancelled') {
    return fail('INVALID_STATUS_TRANSITION', 'Status can only be set to cancelled.')
  }
  return OK
}

export function checkInitialStatus(status: RegistrationStatus | string | null | undefined): RuleResult {
  if (status === undefined || status === null || status === 'confirmed') return OK
  return fail('INVALID_STATUS_TRANSITION', 'New registrations are always confirmed.')
}

export function planCancellation<T extends { id: ID; status: RegistrationStatus | string }>(rows: T[]) {
  const toCancel = rows.filter((row) => row.status === 'confirmed')
  return { toCancel, skipped: rows.length - toCancel.length }
}
