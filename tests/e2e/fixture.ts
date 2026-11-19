import { expect, type Page, type Request } from '@playwright/test'
import fs from 'node:fs'

import { E2E_CREDENTIALS_FILE, E2E_URL } from './env'

type ID = number | string
type Account = { email: string; password: string }

export type E2EFixture = {
  admin: Account
  staff: Account
  eventId: ID
  sessions: { oneSeat: ID; roomy: ID; editable: ID }
  attendees: { unbooked: { id: ID; name: string } }
  registrations: { toCancel: ID; toKeep: ID }
}

let cached: E2EFixture | null = null
export function fixture(): E2EFixture {
  cached ??= JSON.parse(fs.readFileSync(E2E_CREDENTIALS_FILE, 'utf8')) as E2EFixture
  return cached
}

/** Signs in through the login form, like a person would. */
export async function signIn(page: Page, role: 'admin' | 'staff') {
  const account = fixture()[role]
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByRole('link', { name: 'Events', exact: true })).toBeVisible()
}

/** Reads a document through the REST API with the page's session (Payload's CSRF check wants an Origin). */
export async function readDoc<T = Record<string, unknown>>(page: Page, collection: string, id: ID): Promise<T> {
  const response = await page.request.get(`/api/${collection}/${id}?depth=0`, { headers: { Origin: E2E_URL } })
  expect(response.ok()).toBe(true)
  return (await response.json()) as T
}

/** Collects the requests a page sends while the returned list is alive. */
export function recordRequests(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => requests.push(request))
  return requests
}

export const isEventSave = (request: Request) =>
  request.method() === 'PATCH' && new URL(request.url()).pathname.startsWith('/api/events/')
