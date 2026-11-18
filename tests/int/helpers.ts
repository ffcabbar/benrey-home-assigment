import { sql } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'

export async function getTestPayload(): Promise<Payload> {
  return getPayload({ config })
}

export async function resetData(payload: Payload) {
  await payload.db.drizzle.execute(sql`
    TRUNCATE TABLE "registrations", "sessions", "events", "attendees", "ai_usage", "users_sessions", "users",
      "payload_locked_documents_rels", "payload_locked_documents", "payload_preferences_rels", "payload_preferences"
    RESTART IDENTITY CASCADE`)
}

const HOUR = 60 * 60 * 1000

export async function createUsers(payload: Payload) {
  const admin = (await payload.create({
    collection: 'users',
    data: { email: 'admin@test.local', password: 'test-password-admin', name: 'Admin', role: 'admin' },
  })) as User
  const staff = (await payload.create({
    collection: 'users',
    data: { email: 'staff@test.local', password: 'test-password-staff', name: 'Staff', role: 'staff' },
  })) as User
  return { admin: { ...admin, collection: 'users' as const }, staff: { ...staff, collection: 'users' as const } }
}

export async function createOpenSession(
  payload: Payload,
  { capacity = 10, startOffsetHours = 72, durationHours = 1, status = 'published' as const } = {},
) {
  const start = new Date(Date.now() + startOffsetHours * HOUR)
  const event = await payload.create({
    collection: 'events',
    data: {
      title: `Test event ${Math.random().toString(36).slice(2, 8)}`,
      venue: 'Test venue',
      status,
      startsAt: new Date(start.getTime() - 12 * HOUR).toISOString(),
      endsAt: new Date(start.getTime() + 24 * HOUR).toISOString(),
    },
  })
  const session = await payload.create({
    collection: 'sessions',
    data: {
      event: event.id,
      title: 'Test session',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + durationHours * HOUR).toISOString(),
      capacity,
    },
  })
  return { event, session }
}

let attendeeCounter = 0
export async function createAttendees(payload: Payload, count: number) {
  const created = []
  for (let i = 0; i < count; i++) {
    attendeeCounter++
    created.push(
      await payload.create({
        collection: 'attendees',
        data: { fullName: `Attendee ${attendeeCounter}`, email: `attendee${attendeeCounter}-${Date.now()}@test.local` },
      }),
    )
  }
  return created
}

export async function confirmedCount(payload: Payload, sessionId: number) {
  const { totalDocs } = await payload.count({
    collection: 'registrations',
    where: { and: [{ session: { equals: sessionId } }, { status: { equals: 'confirmed' } }] },
  })
  return totalDocs
}

export async function rest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  { token, body, form }: { token?: string; body?: unknown; form?: FormData } = {},
) {
  const { handleEndpoints } = await import('payload')
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `JWT ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const request = new Request(`http://localhost:3000/api${path}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const response = await handleEndpoints({ config, request })
  const text = await response.text()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, body: json }
}

// removeTokenFromResponses is on, so the token is only in Set-Cookie.
export async function loginToken(_payload: Payload, email: string, password: string) {
  const { handleEndpoints } = await import('payload')
  const response = await handleEndpoints({
    config,
    request: new Request('http://localhost:3000/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  })
  const token = /payload-token=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1]
  if (response.status !== 200 || !token) throw new Error(`login failed for ${email} (${response.status})`)
  return token
}
