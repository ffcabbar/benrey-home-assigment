import { expect, test, type Page } from '@playwright/test'

import { E2E_URL } from './env'
import { fixture, readDoc, signIn } from './fixture'

type Session = { seatsLeft: number }
type Registration = { status: string }

async function selectRelationship(page: Page, field: string, search: string, option: RegExp) {
  await page.locator(`#field-${field}`).click()
  await page.keyboard.type(search)
  await page.getByRole('option', { name: option }).click()
}

async function openRegistrationRow(page: Page, attendeeName: string) {
  await page.goto(`/admin/collections/registrations?search=${encodeURIComponent(attendeeName)}`)
  const row = page.getByRole('row', { name: new RegExp(attendeeName) })
  await expect(row).toHaveCount(1)
  return row
}

test('staff cannot book the last seat twice', async ({ page }) => {
  const { attendees } = fixture()
  await signIn(page, 'staff')
  await page.goto('/admin/collections/registrations/create')

  await selectRelationship(page, 'attendee', 'Alan', new RegExp(attendees.unbooked.name))
  await selectRelationship(page, 'session', 'One seat', /Workshop: One seat only/)
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Session is full')).toBeVisible()
  await expect(page).toHaveURL(/\/registrations\/create/)
  const alanBookings = await page.request.get(
    `/api/registrations?depth=0&where[attendee][equals]=${attendees.unbooked.id}`,
    { headers: { Origin: E2E_URL } },
  )
  expect(((await alanBookings.json()) as { totalDocs: number }).totalDocs).toBe(0)
})

test('staff cancel a registration from the list and the seat is freed', async ({ page }) => {
  const { sessions, registrations } = fixture()
  await signIn(page, 'staff')
  const seatsBefore = (await readDoc<Session>(page, 'sessions', sessions.roomy)).seatsLeft

  const row = await openRegistrationRow(page, 'Grace Hopper')
  await row.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Cancel selected registrations' }).click()
  await page.getByRole('button', { name: 'Cancel registrations' }).click()

  await expect(page.getByText('Cancelled 1, skipped 0')).toBeVisible()
  await expect(row.getByText('Cancelled')).toBeVisible()
  expect((await readDoc<Registration>(page, 'registrations', registrations.toCancel)).status).toBe('cancelled')
  expect((await readDoc<Session>(page, 'sessions', sessions.roomy)).seatsLeft).toBe(seatsBefore + 1)
})

test('a lost connection during bulk cancel does not claim an outcome', async ({ page }) => {
  const { registrations } = fixture()
  await signIn(page, 'staff')
  await page.route('**/api/registrations/cancel', (route) => route.abort('internetdisconnected'))

  const row = await openRegistrationRow(page, 'Katherine Johnson')
  await row.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Cancel selected registrations' }).click()
  await page.getByRole('button', { name: 'Cancel registrations' }).click()

  await expect(page.getByText("We couldn't confirm the result.", { exact: false })).toBeVisible()
  await expect(page.getByText('nothing was cancelled')).toHaveCount(0)
  // The aborted request never reached the server, so the row is untouched and can be retried.
  await expect(row.getByText('Confirmed')).toBeVisible()
  expect((await readDoc<Registration>(page, 'registrations', registrations.toKeep)).status).toBe('confirmed')
})
