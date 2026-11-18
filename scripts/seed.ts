import 'dotenv/config'

import { sql } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'
import { cancelRegistrations, registerAttendee } from '../src/services/registrations'
import { BANNER_COUNT, makeBanner } from './seed/banners'
import { buildSeedPlan } from './seed/plan'

const CONCURRENCY = 8

async function inBatches<T>(items: T[], worker: (item: T, index: number) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function requireSeedEnv() {
  const names = ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_STAFF_EMAIL', 'SEED_STAFF_PASSWORD'] as const
  const missing = names.filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    console.error(`Seed refused: set ${missing.join(', ')} (see .env.example).`)
    process.exit(1)
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name]!.trim()])) as Record<(typeof names)[number], string>
}

async function reset(payload: Payload) {
  const media = await payload.find({ collection: 'media', limit: 0, pagination: false, depth: 0 })
  if (media.docs.length) {
    await payload.delete({ collection: 'media', where: { id: { in: media.docs.map((m) => m.id) } } })
  }
  await payload.db.drizzle.execute(sql`
    TRUNCATE TABLE
      "registrations", "sessions", "events", "attendees", "media", "ai_usage",
      "users_sessions", "users",
      "payload_locked_documents_rels", "payload_locked_documents",
      "payload_preferences_rels", "payload_preferences"
    RESTART IDENTITY CASCADE`)
}

async function main() {
  const startedAt = Date.now()
  const env = requireSeedEnv()
  const shouldReset = process.argv.includes('--reset')
  const payload = await getPayload({ config })

  if (shouldReset) {
    console.log('Resetting data…')
    await reset(payload)
  } else {
    const { totalDocs } = await payload.count({ collection: 'events' })
    if (totalDocs > 0) {
      console.error('Database already has data. Run `pnpm seed --reset` to wipe and reseed.')
      process.exit(1)
    }
  }

  const plan = buildSeedPlan()

  console.log('Users…')
  await payload.create({
    collection: 'users',
    data: { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, name: 'Ada Admin', role: 'admin' },
  })
  await payload.create({
    collection: 'users',
    data: { email: env.SEED_STAFF_EMAIL, password: env.SEED_STAFF_PASSWORD, name: 'Sam Staff', role: 'staff' },
  })

  console.log('Banner images → S3…')
  const mediaIds: number[] = []
  for (let i = 0; i < BANNER_COUNT; i++) {
    const data = await makeBanner(i, ['Summit', 'Conference', 'Forum', 'Workshop', 'Meetup', 'Expo', 'Days', 'Keynote'][i])
    const doc = await payload.create({
      collection: 'media',
      data: { alt: `Abstract event banner ${i + 1}` },
      file: { data, mimetype: 'image/webp', name: `banner-${i + 1}.webp`, size: data.length },
    })
    mediaIds.push(doc.id)
  }

  console.log('Events and sessions…')
  const eventIds = new Map<number, number>()
  for (const event of plan.events) {
    const doc = await payload.create({
      collection: 'events',
      data: {
        title: event.title,
        venue: event.venue,
        description: event.description,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        banner: event.bannerIndex === null ? null : mediaIds[event.bannerIndex],
      },
      depth: 0,
    })
    eventIds.set(event.key, doc.id)
  }
  const sessionIds = new Map<number, number>()
  await inBatches(plan.sessions, async (session) => {
    const doc = await payload.create({
      collection: 'sessions',
      data: {
        event: eventIds.get(session.eventKey)!,
        title: session.title,
        room: session.room,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        capacity: session.capacity,
      },
      depth: 0,
      context: { skipSeatCount: true },
    })
    sessionIds.set(session.key, doc.id)
  })

  console.log('Attendees…')
  const attendeeIds = new Map<number, number>()
  await inBatches(plan.attendees, async (attendee) => {
    const doc = await payload.create({
      collection: 'attendees',
      data: { fullName: attendee.fullName, email: attendee.email, company: attendee.company },
      depth: 0,
    })
    attendeeIds.set(attendee.key, doc.id)
  })

  console.log(`Registrations (${plan.registrations.length})…`)
  const registrationIds: number[] = new Array(plan.registrations.length)
  let done = 0
  await inBatches(plan.registrations, async (row, index) => {
    const doc = await registerAttendee({
      payload,
      attendeeId: attendeeIds.get(row.attendeeKey)!,
      sessionId: sessionIds.get(row.sessionKey)!,
      clock: row.registeredAt,
    })
    registrationIds[index] = doc.id
    if (++done % 1000 === 0) console.log(`  ${done}`)
  })

  console.log('Cancellations…')
  const toCancel = plan.registrations.flatMap((row, index) => (row.cancel ? [{ row, id: registrationIds[index] }] : []))
  const bySession = new Map<number, typeof toCancel>()
  for (const item of toCancel) bySession.set(item.row.sessionKey, [...(bySession.get(item.row.sessionKey) ?? []), item])
  let cancelled = 0
  await inBatches([...bySession.values()], async (items) => {
    const latest = Math.max(...items.map((item) => item.row.registeredAt.getTime()))
    const result = await cancelRegistrations({
      payload,
      ids: items.map((item) => item.id),
      clock: new Date(Math.min(Date.now(), latest + 6 * 60 * 60 * 1000)),
    })
    cancelled += result.cancelled
  })

  const [{ over_capacity }] = (
    await payload.db.drizzle.execute(sql`
      SELECT count(*)::int AS over_capacity FROM (
        SELECT s.id FROM sessions s JOIN registrations r ON r.session_id = s.id AND r.status = 'confirmed'
        GROUP BY s.id, s.capacity HAVING count(*) > s.capacity) t`)
  ).rows as Array<{ over_capacity: number }>
  const [{ overlaps }] = (
    await payload.db.drizzle.execute(sql`
      SELECT count(*)::int AS overlaps
      FROM registrations a
      JOIN registrations b ON a.attendee_id = b.attendee_id AND a.id < b.id
        AND a.status = 'confirmed' AND b.status = 'confirmed'
      JOIN sessions sa ON sa.id = a.session_id
      JOIN sessions sb ON sb.id = b.session_id
      WHERE sa.starts_at < sb.ends_at AND sb.starts_at < sa.ends_at`)
  ).rows as Array<{ overlaps: number }>
  const [{ full_sessions }] = (
    await payload.db.drizzle.execute(sql`
      SELECT count(*)::int AS full_sessions FROM (
        SELECT s.id FROM sessions s JOIN registrations r ON r.session_id = s.id AND r.status = 'confirmed'
        GROUP BY s.id, s.capacity HAVING count(*) = s.capacity) t`)
  ).rows as Array<{ full_sessions: number }>

  const counts = {
    users: (await payload.count({ collection: 'users' })).totalDocs,
    media: (await payload.count({ collection: 'media' })).totalDocs,
    events: (await payload.count({ collection: 'events' })).totalDocs,
    published: (await payload.count({ collection: 'events', where: { status: { equals: 'published' } } })).totalDocs,
    draft: (await payload.count({ collection: 'events', where: { status: { equals: 'draft' } } })).totalDocs,
    cancelledEvents: (await payload.count({ collection: 'events', where: { status: { equals: 'cancelled' } } })).totalDocs,
    sessions: (await payload.count({ collection: 'sessions' })).totalDocs,
    attendees: (await payload.count({ collection: 'attendees' })).totalDocs,
    registrations: (await payload.count({ collection: 'registrations' })).totalDocs,
    confirmed: (await payload.count({ collection: 'registrations', where: { status: { equals: 'confirmed' } } })).totalDocs,
  }

  console.log('\nSeed complete')
  console.table({
    Users: counts.users,
    'Banner images': counts.media,
    Events: `${counts.events} (${counts.published} published, ${counts.draft} draft, ${counts.cancelledEvents} cancelled)`,
    Sessions: `${counts.sessions} (${full_sessions} full)`,
    Attendees: counts.attendees,
    Registrations: `${counts.registrations} (${counts.confirmed} confirmed, ${cancelled} cancelled)`,
    'Sessions over capacity': over_capacity,
    'Overlapping confirmed bookings': overlaps,
    Duration: `${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
  })
  console.log(`Log in at /admin as ${env.SEED_ADMIN_EMAIL} (admin) or ${env.SEED_STAFF_EMAIL} (staff).`)

  if (over_capacity !== 0 || overlaps !== 0) process.exit(1)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
