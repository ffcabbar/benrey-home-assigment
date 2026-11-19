/**
 * Resets the E2E database and creates a small, known fixture. Run by Playwright's webServer
 * command (with the env from ./env.ts) before the app is built and started.
 */
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'

import { assertE2EDatabase, E2E_CREDENTIALS_FILE, E2E_STATE_DIR } from './env'
import type { E2EFixture } from './fixture'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

async function main() {
  assertE2EDatabase(process.env.DATABASE_URL ?? '')
  const { getPayload } = await import('payload')
  const { default: config } = await import('../../src/payload.config')
  const { migrations } = await import('../../src/migrations')
  const { registerAttendee } = await import('../../src/services/registrations')

  const payload = await getPayload({ config })
  const db = payload.db as unknown as PostgresAdapter
  await db.dropDatabase({ adapter: db })
  await db.migrate({ migrations: migrations as never })

  const password = () => randomBytes(18).toString('base64url')
  const admin = { email: 'admin@e2e.test', password: password() }
  const staff = { email: 'staff@e2e.test', password: password() }
  await payload.create({ collection: 'users', data: { ...admin, name: 'Ada Admin', role: 'admin' } })
  await payload.create({ collection: 'users', data: { ...staff, name: 'Sam Staff', role: 'staff' } })

  const dayOne = new Date(Math.floor(Date.now() / DAY) * DAY + 7 * DAY)
  const at = (day: number, hour: number) => new Date(dayOne.getTime() + day * DAY + hour * HOUR).toISOString()
  const event = await payload.create({
    collection: 'events',
    data: { title: 'E2E Product Summit', venue: 'Test Hall, Tallinn', status: 'published', startsAt: at(0, 8), endsAt: at(1, 18) },
  })
  const session = (title: string, day: number, hour: number, capacity: number) =>
    payload.create({
      collection: 'sessions',
      data: { event: event.id, title, startsAt: at(day, hour), endsAt: at(day, hour + 1), capacity },
    })
  const oneSeat = await session('Workshop: One seat only', 0, 10, 1)
  const roomy = await session('Talk: Plenty of seats', 0, 12, 50)
  const editable = await session('Panel: Edit me', 1, 10, 20)

  const attendee = (fullName: string, email: string) =>
    payload.create({ collection: 'attendees', data: { fullName, email } })
  const ada = await attendee('Ada Lovelace', 'ada@e2e.test')
  const grace = await attendee('Grace Hopper', 'grace@e2e.test')
  const alan = await attendee('Alan Turing', 'alan@e2e.test')
  const katherine = await attendee('Katherine Johnson', 'katherine@e2e.test')

  await registerAttendee({ payload, attendeeId: ada.id, sessionId: oneSeat.id })
  const toCancel = await registerAttendee({ payload, attendeeId: grace.id, sessionId: roomy.id })
  const toKeep = await registerAttendee({ payload, attendeeId: katherine.id, sessionId: roomy.id })

  const fixture: E2EFixture = {
    admin,
    staff,
    eventId: event.id,
    sessions: { oneSeat: oneSeat.id, roomy: roomy.id, editable: editable.id },
    attendees: { unbooked: { id: alan.id, name: alan.fullName } },
    registrations: { toCancel: toCancel.id, toKeep: toKeep.id },
  }
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true })
  fs.writeFileSync(E2E_CREDENTIALS_FILE, JSON.stringify(fixture, null, 2), { mode: 0o600 })
  await payload.destroy()
  console.log('E2E fixture ready')
  // Payload's postgres adapter keeps a pool client checked out, so the process would not exit alone.
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
