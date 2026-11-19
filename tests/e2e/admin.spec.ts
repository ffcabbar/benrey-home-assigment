import { expect, test } from '@playwright/test'

import { fixture, isEventSave, readDoc, recordRequests, signIn } from './fixture'

test.describe('roles', () => {
  test('admin sees user management; staff does not and can only read events', async ({ page }) => {
    await signIn(page, 'admin')
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible()

    await page.context().clearCookies()
    await signIn(page, 'staff')
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)

    await page.goto(`/admin/collections/events/${fixture().eventId}`)
    await expect(page.locator('#field-title')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
  })
})

test('admin edits a session from inside its event without saving the event', async ({ page }) => {
  const { eventId, sessions } = fixture()
  await signIn(page, 'admin')
  const eventBefore = await readDoc<{ updatedAt: string }>(page, 'events', eventId)

  await page.goto(`/admin/collections/events/${eventId}`)
  await page.getByRole('row', { name: /Panel: Edit me/ }).getByRole('button').first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: /Panel: Edit me/ })).toBeVisible()

  await drawer.locator('#field-room').fill('Hall Z')
  await drawer.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Updated successfully.')).toBeVisible()

  expect((await readDoc<{ room: string }>(page, 'sessions', sessions.editable)).room).toBe('Hall Z')
  expect((await readDoc<{ updatedAt: string }>(page, 'events', eventId)).updatedAt).toBe(eventBefore.updatedAt)
})

test('the form assistant describes the session open in a drawer, then the event again', async ({ page }) => {
  const asked: string[] = []
  await page.route('**/api/field-help', async (route) => {
    asked.push((route.request().postDataJSON() as { collection: string }).collection)
    await route.fulfill({ json: { answer: 'Stubbed answer.' } })
  })
  const { eventId } = fixture()
  await signIn(page, 'admin')
  const eventBefore = await readDoc<{ updatedAt: string }>(page, 'events', eventId)
  const requests = recordRequests(page)

  await page.goto(`/admin/collections/events/${eventId}`)
  await page.getByRole('row', { name: /Panel: Edit me/ }).getByRole('button').first().click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Panel: Edit me/ })).toBeVisible()

  // Inside the drawer: the widget must be reachable and keep keyboard focus.
  await page.getByRole('button', { name: 'Ask about this form' }).click()
  const question = page.getByPlaceholder("e.g. Why can't I register this attendee?")
  await expect(question).toBeFocused()
  await page.keyboard.type('What does capacity mean?')
  await expect(question).toHaveValue('What does capacity mean?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText('Stubbed answer.')).toBeVisible()
  // The Enter key is the other way to send; it must not submit the session form either.
  await question.fill('')
  await page.keyboard.type('Can I change the room?')
  await page.keyboard.press('Enter')
  await expect.poll(() => asked).toEqual(['sessions', 'sessions'])

  // Back on the event page the widget describes the event form.
  await page.getByRole('dialog').locator('.doc-drawer__header-close').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ask about this form' }).click()
  await page.keyboard.type('Which fields are required?')
  await page.keyboard.press('Enter')
  await expect.poll(() => asked).toEqual(['sessions', 'sessions', 'events'])

  expect(requests.filter(isEventSave)).toHaveLength(0)
  expect(requests.filter((r) => r.method() === 'PATCH' && r.url().includes('/api/sessions/'))).toHaveLength(0)
  expect((await readDoc<{ updatedAt: string }>(page, 'events', eventId)).updatedAt).toBe(eventBefore.updatedAt)
})
