import type { Instant, TimeRange } from './types'

export const toMillis = (value: Instant): number => {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : Number.NaN
}

export const isValidInstant = (value: Instant | null | undefined): value is Instant =>
  value !== null && value !== undefined && Number.isFinite(toMillis(value))

// Half-open: a session ending at 10:00 does not overlap one starting at 10:00.
export const rangesOverlap = (a: TimeRange, b: TimeRange): boolean =>
  toMillis(a.startsAt) < toMillis(b.endsAt) && toMillis(b.startsAt) < toMillis(a.endsAt)

export const rangeContains = (outer: TimeRange, inner: TimeRange): boolean =>
  toMillis(outer.startsAt) <= toMillis(inner.startsAt) && toMillis(inner.endsAt) <= toMillis(outer.endsAt)
