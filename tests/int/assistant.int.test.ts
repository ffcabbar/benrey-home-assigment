import type { Payload, PayloadRequest } from 'payload'
import { createLocalReq } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildContextFromPayload } from '@/ai/fieldHelp'
import { ASSISTANT_LIMIT_PER_HOUR, consumeAssistantQuota } from '@/ai/rateLimit'

import { createUsers, getTestPayload, resetData, rest, loginToken } from './helpers'

let payload: Payload
let users: Awaited<ReturnType<typeof createUsers>>

beforeAll(async () => {
  payload = await getTestPayload()
  await resetData(payload)
  users = await createUsers(payload)
})

afterAll(async () => {
  await resetData(payload)
  await payload.destroy()
})

const reqFor = (user: unknown) => createLocalReq({ user: user as never }, payload) as Promise<PayloadRequest>

describe('assistant context from real Payload permissions', () => {
  it('staff: sessions view-only; registrations create + update (cancel); own account editable, role not', async () => {
    const req = await reqFor(users.staff)
    const sessions = await buildContextFromPayload(req, 'sessions')
    expect(sessions?.permissions).toEqual({ create: false, update: false, delete: false })
    expect(sessions?.fields.find((f) => f.name === 'capacity')).toMatchObject({ editable: false, required: true })

    const registrations = await buildContextFromPayload(req, 'registrations')
    expect(registrations?.permissions).toEqual({ create: true, update: true, delete: false })
    expect(registrations?.fields.find((f) => f.name === 'status')?.description).toMatch(/Cancelling is final/)

    const usersContext = await buildContextFromPayload(req, 'users')
    expect(usersContext?.permissions).toEqual({ create: false, update: true, delete: false })
    expect(usersContext?.fields.find((f) => f.name === 'name')?.editable).toBe(true)
    expect(usersContext?.fields.find((f) => f.name === 'role')?.editable).toBe(false)
  })

  it('admin: full permissions and editable capacity', async () => {
    const req = await reqFor(users.admin)
    const sessions = await buildContextFromPayload(req, 'sessions')
    expect(sessions?.permissions).toEqual({ create: true, update: true, delete: true })
    expect(sessions?.fields.find((f) => f.name === 'capacity')?.editable).toBe(true)
    const registrations = await buildContextFromPayload(req, 'registrations')
    expect(registrations?.permissions).toEqual({ create: true, update: true, delete: true })
  })
})

describe('rate limit stored in Postgres', () => {
  it(`allows ${ASSISTANT_LIMIT_PER_HOUR} questions per user per hour, then refuses`, async () => {
    const req = await reqFor(users.staff)
    for (let i = 0; i < ASSISTANT_LIMIT_PER_HOUR; i++) {
      const result = await consumeAssistantQuota({ req, userId: users.staff.id, collection: 'events' })
      expect(result.allowed).toBe(true)
    }
    const blocked = await consumeAssistantQuota({ req, userId: users.staff.id, collection: 'events' })
    expect(blocked).toMatchObject({ allowed: false, limit: ASSISTANT_LIMIT_PER_HOUR })

    expect((await consumeAssistantQuota({ req, userId: users.admin.id, collection: 'events' })).allowed).toBe(true)
    const later = new Date(Date.now() + 61 * 60 * 1000)
    expect((await consumeAssistantQuota({ req, userId: users.staff.id, collection: 'events', now: later })).allowed).toBe(true)
  })

  it('the ai-usage store is not reachable through the API', async () => {
    const token = await loginToken(payload, 'admin@test.local', 'test-password-admin')
    expect((await rest('GET', '/ai-usage', { token })).status).toBe(403)
  })

  it('endpoint reports assistant_disabled when no LLM key is configured', async () => {
    const token = await loginToken(payload, 'staff@test.local', 'test-password-staff')
    const res = await rest('POST', '/field-help', { token, body: { collection: 'sessions', question: 'What is capacity?' } })
    expect(res).toEqual({ status: 503, body: { error: 'assistant_disabled' } })
  })
})
