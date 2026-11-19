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

const TOPICS = ['Product', 'Data', 'Frontend', 'Cloud', 'Security', 'Design', 'AI', 'DevOps', 'Mobile', 'Leadership', 'Platform', 'Growth'] as const
const KINDS = ['Summit', 'Conference', 'Forum', 'Days', 'Expo', 'Meetup']
const VENUES = ['Congress Center', 'Convention Hall', 'Kulturbrauerei', 'Exhibition Grounds', 'Riverside Pavilion', 'Old Town Hall', 'Tech Campus', 'Harbour Studios']
const ROOMS = ['Main Stage', 'Hall A', 'Hall B', 'Workshop Room 1', 'Workshop Room 2', 'Lounge', 'Auditorium']
const FORMATS = ['Keynote', 'Talk', 'Workshop', 'Panel', 'Lightning talks', 'Fireside chat']

// Session titles per event topic, so a "Security Summit" only lists security talks.
// Each list is longer than the 7 sessions an event can have, so titles never repeat within an event.
const SESSION_TITLES: Record<(typeof TOPICS)[number], string[]> = {
  Product: [
    'Writing product specs engineers actually read',
    'Saying no to the roadmap',
    'Discovery interviews that change decisions',
    'Pricing experiments without breaking trust',
    'From feature factory to outcomes',
    'Measuring activation that predicts retention',
    'Running a beta that teaches you something',
    'Prioritisation when everything is urgent',
    'Product analytics on a small team',
    'Shipping smaller, learning faster',
    'The first hundred days as a product lead',
    'Working with sales without becoming a services team',
    'Killing a feature gracefully',
    'Onboarding flows that respect the user',
    'What we learned from our failed launch',
  ],
  Data: [
    'Postgres past the first billion rows',
    'Data contracts between producers and consumers',
    'Building a metrics layer people trust',
    'Streaming or batch: choosing honestly',
    'Data quality checks that catch real problems',
    'Cost control for the modern data warehouse',
    'dbt at scale: lessons from 2,000 models',
    'Event tracking plans that survive a rewrite',
    'Privacy-preserving analytics',
    'From dashboards to decisions',
    'Running Kafka without a platform team',
    'Slowly changing dimensions in practice',
    'Self-serve data for non-analysts',
    'Debugging a broken pipeline at 3 a.m.',
    'Lakehouse architecture without the hype',
  ],
  Frontend: [
    'Server components in production',
    'Accessibility audits that lead to fixes',
    'CSS architecture for large teams',
    'Core Web Vitals: what actually moved the needle',
    'Testing UI without flaky snapshots',
    'State management after the framework wars',
    'Design tokens from Figma to code',
    'Forms that do not lose user input',
    'Bundle size budgets in CI',
    'Internationalisation beyond translation strings',
    'Micro-frontends: when they are worth it',
    'Animation that respects reduced motion',
    'Migrating a legacy SPA one route at a time',
    'Type-safe APIs from backend to browser',
    'Offline-first web apps',
  ],
  Cloud: [
    'Cutting our cloud bill by 40%',
    'Multi-region without multi-headaches',
    'Kubernetes for teams of five',
    'Serverless cold starts in the real world',
    'Infrastructure as code that reviewers can read',
    'Designing for zone failures',
    'Object storage patterns at scale',
    'Choosing a managed database',
    'Networking basics every developer should know',
    'Disaster recovery drills that work',
    'Leaving a cloud provider: a migration story',
    'Autoscaling without surprises',
    'Secrets management across environments',
    'Tagging strategies for cost visibility',
    'The hidden costs of egress',
  ],
  Security: [
    'Threat modelling for product teams',
    'Secrets in the repo: detection and cleanup',
    'Passkeys in practice',
    'Running a bug bounty programme',
    'Supply chain security for npm projects',
    'Incident response: the first hour',
    'Least privilege in cloud IAM',
    'Secure defaults in web frameworks',
    'Phishing-resistant authentication rollout',
    'Security reviews that do not block shipping',
    'Logging for forensics',
    'OAuth pitfalls we keep repeating',
    'Container image hardening',
    'Building a security champions programme',
    'Lessons from a ransomware tabletop exercise',
  ],
  Design: [
    'Design systems that survive reorgs',
    'Research on a shoestring budget',
    'Designing empty states',
    'Accessible colour systems',
    'Prototyping with real data',
    'Writing interface copy',
    'Design critique that helps',
    'Dark patterns and how to avoid them',
    'Information architecture for growing products',
    'Designing for slow networks',
    'Motion design with purpose',
    'Handing off to engineering without a handoff',
    'Usability testing in an afternoon',
    'Typography for interfaces',
    'Designing admin tools people enjoy',
  ],
  AI: [
    'Evaluating LLM features before launch',
    'Retrieval-augmented generation in production',
    'Prompt injection: threats and defences',
    'Cost and latency budgets for AI features',
    'Fine-tuning versus prompting: a decision guide',
    'Human review loops for model output',
    'Shipping an AI assistant users trust',
    'Vector search without a vector database',
    'Observability for LLM applications',
    'Guardrails that do not ruin the product',
    'Agents in production: what broke',
    'Building datasets for evaluation',
    'Responsible AI checklists that teams use',
    'Small models, big wins',
    'Grounding answers in your own data',
  ],
  DevOps: [
    'CI pipelines under ten minutes',
    'Trunk-based development in practice',
    'On-call without burnout',
    'Blameless postmortems that lead to change',
    'Feature flags as a deployment strategy',
    'Observability: logs, metrics and traces together',
    'Zero-downtime database migrations',
    'Release trains versus continuous delivery',
    'SLOs that the business understands',
    'Runbooks people actually follow',
    'Preview environments for every pull request',
    'Dependency updates on autopilot',
    'Canary releases explained',
    'Infrastructure drift detection',
    'Measuring DORA metrics honestly',
  ],
  Mobile: [
    'Offline sync for mobile apps',
    'Crash-free sessions above 99.9%',
    'Shipping React Native at scale',
    'App Store review survival guide',
    'Push notifications users do not disable',
    'Mobile performance on low-end devices',
    'Deep links done right',
    'Release management for mobile teams',
    'Accessibility on iOS and Android',
    'In-app purchases without the pain',
    'Feature flags on mobile',
    'Testing on real devices',
    'Battery-friendly background work',
    'Migrating to Swift concurrency',
    'Kotlin Multiplatform in production',
  ],
  Leadership: [
    'From engineer to manager: the first year',
    'Running effective one-on-ones',
    'Hiring for a small team',
    'Giving feedback that lands',
    'Technical strategy on one page',
    'Leading through a reorg',
    'Remote teams across time zones',
    'Managing managers',
    'Building a career ladder',
    'Decision records and why they matter',
    'Onboarding engineers in their first month',
    'Handling underperformance with care',
    'Staff engineers and their scope',
    'Planning without false precision',
    'Burnout: noticing it early',
  ],
  Platform: [
    'Building an internal developer platform',
    'Golden paths for new services',
    'Platform as a product',
    'Service catalogues that stay current',
    'Self-service infrastructure',
    'API gateways in practice',
    'Paved roads versus guardrails',
    'Measuring developer experience',
    'Multi-tenant platform design',
    'Deprecating internal APIs',
    'Developer portals: build or buy',
    'Standardising observability across teams',
    'Platform team topologies',
    'Ownership and on-call for shared services',
    'Templates that evolve with the code',
  ],
  Growth: [
    'Growth loops beyond referrals',
    'Running A/B tests with small traffic',
    'Onboarding experiments that worked',
    'Lifecycle email without spam',
    'SEO for product-led companies',
    'Activation metrics that matter',
    'Retention curves explained',
    'Pricing pages that convert',
    'Product-led sales',
    'Attribution in a privacy-first world',
    'Community-led growth',
    'Paywalls and free trials',
    'Reducing churn with better support',
    'Growth team rituals',
    'Experiment review boards',
  ],
}

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
    const titles = faker.helpers.arrayElements(SESSION_TITLES[topic], sessionCount)
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
        title: `${format}: ${titles[s]}`,
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
