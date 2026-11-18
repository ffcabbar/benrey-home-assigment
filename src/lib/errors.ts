import { APIError, ValidationError } from 'payload'
import type { AfterErrorHook } from 'payload'

import { MESSAGES, type RuleCode, type RuleResult } from '@/domain/registration'

export class RuleViolationError extends APIError<{ code: RuleCode }> {
  readonly code: RuleCode
  readonly source: 'domain' | 'database'

  constructor(code: RuleCode, message: string, source: 'domain' | 'database' = 'domain') {
    super(message, 400, { code }, true)
    this.name = 'RuleViolationError'
    this.code = code
    this.source = source
  }
}

export function assertRule(result: RuleResult, options: { path?: string; collection?: string } = {}): void {
  if (result.ok) return
  if (options.path) {
    throw new ValidationError({
      collection: options.collection,
      errors: [{ message: result.message, path: options.path }],
    })
  }
  throw new RuleViolationError(result.code, result.message)
}

// Names raised by the migrations; keep in sync.
export const DB_CONSTRAINTS = {
  oneConfirmedPerAttendeeSession: 'registrations_one_confirmed_per_attendee_session',
  sessionFullMessage: 'SESSION_FULL',
  capacityBelowConfirmedMessage: 'CAPACITY_BELOW_CONFIRMED',
  registrationCancelledMessage: 'REGISTRATION_CANCELLED',
} as const

type ErrorLike = {
  message?: unknown
  code?: unknown
  constraint?: unknown
  cause?: unknown
  data?: unknown
}

function* errorChain(error: unknown): Generator<ErrorLike> {
  let current: unknown = error
  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth++) {
    yield current as ErrorLike
    current = (current as ErrorLike).cause
  }
}

const isDuplicateConfirmed = (link: ErrorLike): boolean => {
  if (link.code === '23505' && link.constraint === DB_CONSTRAINTS.oneConfirmedPerAttendeeSession) return true
  // Payload's drizzle adapter turns unique violations into a ValidationError whose path comes
  // from the Postgres detail "Key (attendee_id, session_id)=(…)".
  if (link instanceof ValidationError) {
    const errors = (link.data as { errors?: Array<{ path?: string }> } | undefined)?.errors ?? []
    return errors.some((e) => typeof e.path === 'string' && e.path.includes('attendee_id') && e.path.includes('session_id'))
  }
  return false
}

export function mapDbError(error: unknown): RuleViolationError | null {
  for (const link of errorChain(error)) {
    if (link instanceof RuleViolationError) return link
    const message = typeof link.message === 'string' ? link.message : ''
    if (message.includes(DB_CONSTRAINTS.sessionFullMessage)) {
      return new RuleViolationError('SESSION_FULL', MESSAGES.SESSION_FULL, 'database')
    }
    if (message.includes(DB_CONSTRAINTS.capacityBelowConfirmedMessage)) {
      return new RuleViolationError(
        'CAPACITY_BELOW_CONFIRMED',
        "Capacity can't be lower than the number of confirmed registrations.",
        'database',
      )
    }
    if (message.includes(DB_CONSTRAINTS.registrationCancelledMessage)) {
      return new RuleViolationError(
        'REGISTRATION_CANCELLED',
        'Cancelled registrations can’t be changed. Create a new registration instead.',
        'database',
      )
    }
    if (isDuplicateConfirmed(link)) {
      return new RuleViolationError('ALREADY_REGISTERED', MESSAGES.ALREADY_REGISTERED, 'database')
    }
  }
  return null
}

export const mapDbErrorsToResponse: AfterErrorHook = ({ error }) => {
  const mapped = mapDbError(error)
  if (!mapped) return
  return {
    status: 400,
    response: { errors: [{ message: mapped.message, data: { code: mapped.code } }] },
  }
}
