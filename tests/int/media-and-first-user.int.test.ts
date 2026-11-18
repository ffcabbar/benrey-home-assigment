import { existsSync } from 'fs'
import path from 'path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, loginToken, resetData, rest } from './helpers'

let payload: Payload

beforeAll(async () => {
  payload = await getTestPayload()
  await resetData(payload)
})

afterAll(async () => {
  const media = await payload.find({ collection: 'media', limit: 0, pagination: false, depth: 0 })
  if (media.docs.length) await payload.delete({ collection: 'media', where: { id: { in: media.docs.map((m) => m.id) } } })
  await resetData(payload)
  await payload.destroy()
})

const upload = (file: Blob, filename: string, alt = 'Test banner') => {
  const form = new FormData()
  form.append('file', file, filename)
  form.append('_payload', JSON.stringify({ alt }))
  return form
}

describe('first user', () => {
  it('the first account created through the admin becomes admin; the endpoint then closes', async () => {
    const first = await rest('POST', '/users/first-register', {
      body: { email: 'first@test.local', password: 'first-password-123', name: 'First' },
    })
    expect(first.status).toBe(200)
    expect(first.body.user.role).toBe('admin')

    const second = await rest('POST', '/users/first-register', {
      body: { email: 'second@test.local', password: 'second-password-123', name: 'Second' },
    })
    expect(second.status).toBe(403)
  })
})

describe('media uploads go to S3 through the REST API', () => {
  let adminToken: string
  let staffToken: string

  beforeAll(async () => {
    adminToken = await loginToken(payload, 'first@test.local', 'first-password-123')
    await payload.create({
      collection: 'users',
      data: { email: 'staff@test.local', password: 'test-password-staff', name: 'Staff', role: 'staff' },
    })
    staffToken = await loginToken(payload, 'staff@test.local', 'test-password-staff')
  })

  it('accepts a PNG from an admin, serves it to staff, refuses anonymous reads', async () => {
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#2453c2' } }).png().toBuffer()
    const created = await rest('POST', '/media', { token: adminToken, form: upload(new Blob([png], { type: 'image/png' }), 'ok.png') })
    expect(created.status).toBe(201)
    const doc = created.body.doc
    expect(doc).toMatchObject({ mimeType: 'image/png', alt: 'Test banner' })

    const fileUrl = new URL(doc.url, 'http://localhost:3000').pathname.replace(/^\/api/, '')
    const asStaff = await rest('GET', fileUrl, { token: staffToken })
    expect(asStaff.status).toBe(200)
    expect((await rest('GET', fileUrl)).status).toBe(403)

    expect(existsSync(path.resolve(process.cwd(), 'media'))).toBe(false)
  })

  it('refuses files over 2 MB', async () => {
    const noise = Buffer.from(Array.from({ length: 1100 * 1100 * 3 }, () => Math.floor(Math.random() * 256)))
    const big = await sharp(noise, { raw: { width: 1100, height: 1100, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024)
    const res = await rest('POST', '/media', { token: adminToken, form: upload(new Blob([big], { type: 'image/png' }), 'big.png') })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect((await payload.count({ collection: 'media', where: { filename: { equals: 'big.png' } } })).totalDocs).toBe(0)
  })

  it('refuses files that are not JPEG/PNG/WebP, even when named .png', async () => {
    const text = new Blob(['just some text, not an image'], { type: 'image/png' })
    const res = await rest('POST', '/media', { token: adminToken, form: upload(text, 'fake.png') })
    expect(res.status).toBe(400)
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' })
    expect((await rest('POST', '/media', { token: adminToken, form: upload(svg, 'x.svg') })).status).toBe(400)
  })

  it('refuses uploads by staff', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer()
    const res = await rest('POST', '/media', { token: staffToken, form: upload(new Blob([png], { type: 'image/png' }), 's.png') })
    expect(res.status).toBe(403)
  })
})
