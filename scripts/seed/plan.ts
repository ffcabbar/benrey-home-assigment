import { faker } from '@faker-js/faker'

import { checkCapacity, checkNoOverlap, checkSessionWithinEvent, type EventStatus } from '../../src/domain/registration'

export const SEED = 20261120
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const HALF_HOUR = HOUR / 2

export type PlannedEvent = {
  key: number
  title: string
  venue: string
  description: string
  status: EventStatus
  startsAt: Date
  endsAt: Date
  bannerIndex: number | null
}
export type PlannedSession = {
  key: number
  eventKey: number
  title: string
  room: string
  startsAt: Date
  endsAt: Date
  capacity: number
  fill: 'full' | 'partial'
}
export type PlannedAttendee = { key: number; fullName: string; email: string; company: string | null }
export type PlannedRegistration = {
  attendeeKey: number
  sessionKey: number
  cancel: boolean
  registeredAt: Date
}

export type SeedPlan = {
  anchor: Date
  events: PlannedEvent[]
  sessions: PlannedSession[]
  attendees: PlannedAttendee[]
  registrations: PlannedRegistration[]
}

const TOPICS = ['Product', 'Data', 'Frontend', 'Cloud', 'Security', 'Design', 'AI', 'DevOps', 'Mobile', 'Leadership', 'Platform', 'Growth']
const KINDS = ['Summit', 'Conference', 'Forum', 'Days', 'Expo', 'Meetup']
const VENUES = ['Congress Center', 'Convention Hall', 'Kulturbrauerei', 'Exhibition Grounds', 'Riverside Pavilion', 'Old Town Hall', 'Tech Campus', 'Harbour Studios']
const ROOMS = ['Main Stage', 'Hall A', 'Hall B', 'Workshop Room 1', 'Workshop Room 2', 'Lounge', 'Auditorium']
const FORMATS = ['Keynote', 'Talk', 'Workshop', 'Panel', 'Lightning talks', 'Fireside chat']

const startOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

export function buildSeedPlan(options: { now?: Date } = {}): SeedPlan {
  faker.seed(SEED)
  const now = options.now ?? new Date()
  const anchor = startOfUtcDay(now)
  faker.setDefaultRefDate(anchor)

  const statuses: EventStatus[] = faker.helpers.shuffle([
    ...Array<EventStatus>(21).fill('published'),
    ...Array<EventStatus>(6).fill('draft'),
    ...Array<EventStatus>(3).fill('cancelled'),
  ])

  const events: PlannedEvent[] = []
  const sessions: PlannedSession[] = []

  for (let i = 0; i < 30; i++) {
    const dayOffset = Math.round(-88 + (176 * i) / 29) + faker.number.int({ min: -2, max: 2 })
    const firstDay = new Date(anchor.getTime() + dayOffset * DAY)
    const days = faker.number.int({ min: 1, max: 3 })
    // All seed times are UTC.
    const startHalfHour = faker.number.int({ min: 16, max: 21 })
    const endHalfHour = faker.number.int({ min: 34, max: 38 })
    const startsAt = new Date(firstDay.getTime() + startHalfHour * HALF_HOUR)
    const endsAt = new Date(firstDay.getTime() + (days - 1) * DAY + endHalfHour * HALF_HOUR)
    const city = faker.location.city()
    const topic = faker.helpers.arrayElement(TOPICS)
    const kind = faker.helpers.arrayElement(KINDS)
    events.push({
      key: i,
      title: `${city} ${topic} ${kind} ${firstDay.getUTCFullYear()}`,
      venue: `${faker.helpers.arrayElement(VENUES)}, ${city}`,
      description: `${faker.company.catchPhrase()}. ${days} day(s) of talks and workshops on ${topic.toLowerCase()}.`,
      status: statuses[i],
      startsAt,
      endsAt,
      bannerIndex: faker.datatype.boolean(0.8) ? faker.number.int({ min: 0, max: 7 }) : null,
    })

    const sessionCount = faker.number.int({ min: 3, max: 7 })
    for (let s = 0; s < sessionCount; s++) {
      const day = faker.number.int({ min: 0, max: days - 1 })
      const dayStart = firstDay.getTime() + day * DAY
      const sessionStartHalfHour = faker.number.int({ min: day === 0 ? startHalfHour : 16, max: 32 })
      const durationMin = faker.helpers.arrayElement([45, 60, 90, 120])
      const sStart = new Date(dayStart + sessionStartHalfHour * HALF_HOUR)
      const dayEnd = Math.min(dayStart + 18 * HOUR, endsAt.getTime())
      const sEnd = new Date(Math.min(sStart.getTime() + durationMin * 60 * 1000, dayEnd))
      const format = faker.helpers.arrayElement(FORMATS)
      const session: PlannedSession = {
        key: sessions.length,
        eventKey: i,
        title: `${format}: ${faker.company.buzzVerb()} ${faker.company.buzzNoun()}`.replace(/^./, (c) => c.toUpperCase()),
        room: faker.helpers.arrayElement(ROOMS),
        startsAt: sStart,
        endsAt: sEnd,
        capacity: faker.number.int({ min: 15, max: 200 }),
        fill: faker.datatype.boolean(0.15) ? 'full' : 'partial',
      }
      const inside = checkSessionWithinEvent(session, events[i])
      if (!inside.ok) throw new Error(`seed plan bug: ${inside.message}`)
      sessions.push(session)
    }
  }

  const attendees: PlannedAttendee[] = []
  const emails = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    let email = faker.internet.email({ firstName, lastName, provider: 'example.com' }).toLowerCase()
    if (emails.has(email)) email = email.replace('@', `.${i}@`)
    emails.add(email)
    attendees.push({
      key: i,
      fullName: `${firstName} ${lastName}`,
      email,
      company: faker.datatype.boolean(0.85) ? faker.company.name() : null,
    })
  }

  const registrations = planRegistrations({ now, events, sessions, attendees })
  return { anchor, events, sessions, attendees, registrations }
}

const TARGET_ROWS = 8000
const CANCEL_SHARE = 0.1

function planRegistrations({
  now,
  events,
  sessions,
  attendees,
}: {
  now: Date
  events: PlannedEvent[]
  sessions: PlannedSession[]
  attendees: PlannedAttendee[]
}): PlannedRegistration[] {
  const open = sessions.filter((s) => events[s.eventKey].status === 'published')
  const fullSeats = open.filter((s) => s.fill === 'full').reduce((sum, s) => sum + s.capacity, 0)
  const partialSeats = open.filter((s) => s.fill === 'partial').reduce((sum, s) => sum + s.capacity, 0)
  const partialRatio = Math.min(0.95, Math.max(0.2, (TARGET_ROWS - fullSeats) / Math.max(partialSeats, 1)))

  const bookings = new Map<number, Array<{ sessionId: number; startsAt: Date; endsAt: Date }>>()
  const rows: PlannedRegistration[] = []
  let cursor = 0

  for (const session of open) {
    const want =
      session.fill === 'full'
        ? session.capacity
        : Math.min(session.capacity, Math.round(session.capacity * partialRatio * faker.number.float({ min: 0.85, max: 1.15 })))
    let taken = 0
    let tries = 0
    while (taken < want && tries < attendees.length) {
      const attendee = attendees[cursor % attendees.length]
      cursor++
      tries++
      const existing = bookings.get(attendee.key) ?? []
      if (existing.some((b) => b.sessionId === session.key)) continue
      if (!checkNoOverlap({ ...session, sessionId: session.key }, existing).ok) continue
      if (!checkCapacity({ capacity: session.capacity, confirmedCount: taken }).ok) break
      existing.push({ sessionId: session.key, startsAt: session.startsAt, endsAt: session.endsAt })
      bookings.set(attendee.key, existing)
      const leadDays = faker.number.int({ min: 1, max: 40 })
      const registeredAt = new Date(Math.min(now.getTime(), session.startsAt.getTime() - leadDays * DAY))
      rows.push({ attendeeKey: attendee.key, sessionKey: session.key, cancel: false, registeredAt })
      taken++
    }
  }

  const fullKeys = new Set(open.filter((s) => s.fill === 'full').map((s) => s.key))
  const cancellable = rows.filter((row) => !fullKeys.has(row.sessionKey))
  const cancelCount = Math.round(rows.length * CANCEL_SHARE)
  for (const row of faker.helpers.arrayElements(cancellable, Math.min(cancelCount, cancellable.length))) {
    row.cancel = true
  }
  return rows
}
