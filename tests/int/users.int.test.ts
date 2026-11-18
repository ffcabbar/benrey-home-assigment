import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { consumeAssistantQuota } from '@/ai/rateLimit'

import { createUsers, getTestPayload, loginToken, resetData, rest } from './helpers'

let payload: Payload
let users: Awaited<ReturnType<typeof createUsers>>

beforeAll(async () => {
  payload = await getTestPayload()
})

beforeEach(async () => {
  await resetData(payload)
  users = await createUsers(payload)
})

afterAll(async () => {
  await resetData(payload)
  await payload.destroy()
})

describe('account self-service', () => {
  it('staff can change their own name and password, then log in with the new password', async () => {
    const token = await loginToken(payload, 'staff@test.local', 'test-password-staff')
    const res = await rest('PATCH', `/users/${users.staff.id}`, {
      token,
      body: { name: 'Sam Renamed', password: 'a-brand-new-password' },
    })
    expect(res.status).toBe(200)
    expect(res.body.doc.name).toBe('Sam Renamed')

    await expect(loginToken(payload, 'staff@test.local', 'test-password-staff')).rejects.toThrow()
    expect(await loginToken(payload, 'staff@test.local', 'a-brand-new-password')).toBeTruthy()
  })

  it('staff cannot update another user', async () => {
    const token = await loginToken(payload, 'staff@test.local', 'test-password-staff')
    const res = await rest('PATCH', `/users/${users.admin.id}`, { token, body: { name: 'Hijacked' } })
    expect([403, 404]).toContain(res.status)
    expect((await payload.findByID({ collection: 'users', id: users.admin.id })).name).toBe('Admin')
  })

  it('nobody can change their own role; an admin can change someone else’s', async () => {
    const staffToken = await loginToken(payload, 'staff@test.local', 'test-password-staff')
    await rest('PATCH', `/users/${users.staff.id}`, { token: staffToken, body: { role: 'admin' } })
    expect((await payload.findByID({ collection: 'users', id: users.staff.id })).role).toBe('staff')

    const adminToken = await loginToken(payload, 'admin@test.local', 'test-password-admin')
    await rest('PATCH', `/users/${users.admin.id}`, { token: adminToken, body: { role: 'staff' } })
    expect((await payload.findByID({ collection: 'users', id: users.admin.id })).role).toBe('admin')
  })
})

describe('password reset by email is closed', () => {
  it('forgot-password and reset-password are refused and no reset token is stored', async () => {
    const forgot = await rest('POST', '/users/forgot-password', { body: { email: 'staff@test.local' } })
    expect(forgot.status).toBe(403)
    expect(forgot.body.errors[0].message).toMatch(/not available/)

    const stored = await payload.findByID({ collection: 'users', id: users.staff.id, showHiddenFields: true })
    expect(stored.resetPasswordToken ?? null).toBeNull()
    expect(stored.resetPasswordExpiration ?? null).toBeNull()

    const reset = await rest('POST', '/users/reset-password', { body: { token: 'anything', password: 'new-password-123' } })
    expect(reset.status).toBe(403)
  })
})

describe('session token', () => {
  it('REST login sets the HTTP-only cookie and returns no token in the body', async () => {
    const res = await rest('POST', '/users/login', { body: { email: 'staff@test.local', password: 'test-password-staff' } })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('staff@test.local')
    expect(res.body).not.toHaveProperty('token')
  })
})

describe('keeping at least one admin', () => {
  it('an admin cannot delete their own account', async () => {
    const token = await loginToken(payload, 'admin@test.local', 'test-password-admin')
    const res = await rest('DELETE', `/users/${users.admin.id}`, { token })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].message).toMatch(/can't delete your own account/)
    expect((await payload.count({ collection: 'users' })).totalDocs).toBe(2)
  })

  it('the last admin cannot be deleted or demoted, even by trusted server code', async () => {
    await expect(payload.delete({ collection: 'users', id: users.admin.id })).rejects.toThrow(/last admin/)
    await expect(
      payload.update({ collection: 'users', id: users.admin.id, data: { role: 'staff' } }),
    ).rejects.toThrow(/last admin/)
    expect((await payload.findByID({ collection: 'users', id: users.admin.id })).role).toBe('admin')
  })

  it('with a second admin, one admin can demote or delete the other', async () => {
    const second = await payload.create({
      collection: 'users',
      data: { email: 'admin2@test.local', password: 'test-password-admin2', name: 'Second', role: 'admin' },
    })
    const token = await loginToken(payload, 'admin@test.local', 'test-password-admin')
    expect((await rest('PATCH', `/users/${second.id}`, { token, body: { role: 'staff' } })).status).toBe(200)
    expect((await rest('DELETE', `/users/${second.id}`, { token })).status).toBe(200)
  })
})

describe('deleting users', () => {
  it('an admin can delete a user who has assistant usage rows; the rows go with them', async () => {
    const req = { payload } as never
    for (let i = 0; i < 3; i++) {
      await consumeAssistantQuota({ req, userId: users.staff.id, collection: 'sessions' })
    }
    const before = await payload.count({ collection: 'ai-usage', where: { user: { equals: users.staff.id } } })
    expect(before.totalDocs).toBe(3)

    const token = await loginToken(payload, 'admin@test.local', 'test-password-admin')
    const res = await rest('DELETE', `/users/${users.staff.id}`, { token })
    expect(res.status).toBe(200)

    const after = await payload.count({ collection: 'ai-usage', where: { user: { equals: users.staff.id } } })
    expect(after.totalDocs).toBe(0)
    expect((await payload.count({ collection: 'users' })).totalDocs).toBe(1)
  })
})
