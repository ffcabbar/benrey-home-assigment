export type ID = number | string

export type Instant = Date | string

export type TimeRange = {
  startsAt: Instant
  endsAt: Instant
}

export type EventStatus = 'draft' | 'published' | 'cancelled'
export type RegistrationStatus = 'confirmed' | 'cancelled'

export type RuleCode =
  | 'INVALID_DATE'
  | 'INVALID_TIME_RANGE'
  | 'SESSION_OUTSIDE_EVENT'
  | 'EVENT_WOULD_EXCLUDE_SESSIONS'
  | 'INVALID_CAPACITY'
  | 'SESSION_FULL'
  | 'CAPACITY_BELOW_CONFIRMED'
  | 'SCHEDULE_CONFLICT'
  | 'SESSION_TIME_CONFLICT'
  | 'EVENT_NOT_OPEN'
  | 'SESSION_ENDED'
  | 'ALREADY_REGISTERED'
  | 'REGISTRATION_CANCELLED'
  | 'INVALID_STATUS_TRANSITION'
  | 'REGISTRATION_IMMUTABLE'

export type RuleOk = { ok: true }
export type RuleFailure = { ok: false; code: RuleCode; message: string }
export type RuleResult = RuleOk | RuleFailure

export const OK: RuleOk = Object.freeze({ ok: true })

export const fail = (code: RuleCode, message: string): RuleFailure => ({ ok: false, code, message })
