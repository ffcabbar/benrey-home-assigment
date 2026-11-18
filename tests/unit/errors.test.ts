import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import { mapDbError, mapDbErrorsToResponse, RuleViolationError } from '@/lib/errors'

describe('mapDbError', () => {
  it('maps the capacity trigger exception, even when wrapped in a cause chain', () => {
    const pgError = Object.assign(new Error('SESSION_FULL: session 3 has no free seats (capacity 1)'), { code: 'BR001' })
    const wrapped = Object.assign(new Error('Failed query: insert into "registrations" …'), { cause: pgError })
    const mapped = mapDbError(wrapped)
    expect(mapped).toBeInstanceOf(RuleViolationError)
    expect(mapped?.message).toBe('Session is full')
    expect(mapped?.status).toBe(400)
  })

  it('maps the partial unique index, raw or as converted by Payload', () => {
    const raw = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'registrations_one_confirmed_per_attendee_session',
    })
    expect(mapDbError(raw)?.message).toBe('Already registered for this session')

    const converted = new ValidationError({
      collection: 'registrations',
      errors: [{ message: 'Value must be unique', path: 'attendee_id, session_id' }],
    })
    expect(mapDbError(converted)?.code).toBe('ALREADY_REGISTERED')
  })

  it('leaves unrelated unique violations and other errors alone', () => {
    const emailTaken = new ValidationError({ collection: 'attendees', errors: [{ message: 'Value must be unique', path: 'email' }] })
    expect(mapDbError(emailTaken)).toBeNull()
    expect(mapDbError(new Error('connection refused'))).toBeNull()
    expect(mapDbError(undefined)).toBeNull()
  })

  it('maps the capacity-floor and one-way-cancel triggers', () => {
    expect(mapDbError(new Error('CAPACITY_BELOW_CONFIRMED: session 1 has 5'))?.code).toBe('CAPACITY_BELOW_CONFIRMED')
    expect(mapDbError(new Error('REGISTRATION_CANCELLED: registration 9'))?.code).toBe('REGISTRATION_CANCELLED')
  })

  it('afterError hook turns a mapped error into a 400 response body', async () => {
    const result = await mapDbErrorsToResponse({
      error: new Error('SESSION_FULL: x'),
    } as unknown as Parameters<typeof mapDbErrorsToResponse>[0])
    expect(result).toEqual({
      status: 400,
      response: { errors: [{ message: 'Session is full', data: { code: 'SESSION_FULL' } }] },
    })
  })
})
