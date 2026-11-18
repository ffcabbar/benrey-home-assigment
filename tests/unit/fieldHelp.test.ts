import Anthropic from '@anthropic-ai/sdk'
import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { FormContext } from '@/ai/fieldContext'
import { createFieldHelpHandler, REFUSAL_ANSWER, SYSTEM_PROMPT, type FieldHelpDeps } from '@/ai/fieldHelp'
import type { QuotaResult } from '@/ai/rateLimit'
import type { MessagesClient } from '@/lib/llm'

const CONTEXT: FormContext = {
  collection: 'sessions',
  label: 'Session',
  description: 'Talks inside an event.',
  permissions: { create: false, update: false, delete: false },
  fields: [
    {
      name: 'capacity',
      label: 'Capacity',
      type: 'number',
      required: true,
      editable: false,
      min: 1,
      description: 'Maximum number of confirmed attendees.',
    },
  ],
  rules: ['Capacity cannot be lowered below the number of confirmed registrations.'],
}

const staff = { id: 2, role: 'staff', collection: 'users', email: 'staff@test.local' }
const valid = { collection: 'sessions', question: 'What does capacity mean?' }

function makeReq(body: unknown, user: unknown = staff) {
  const logger = { warn: vi.fn(), error: vi.fn() }
  const request = new Request('http://localhost:3000/api/field-help', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return Object.assign(request, { user, payload: { logger } }) as unknown as PayloadRequest & {
    payload: { logger: typeof logger }
  }
}

function memoryQuota(limit = 20) {
  const used = new Map<string, number>()
  return vi.fn(async (_req: PayloadRequest, userId: number | string): Promise<QuotaResult> => {
    const count = used.get(String(userId)) ?? 0
    if (count >= limit) return { allowed: false, limit, retryAfterSeconds: 3600 }
    used.set(String(userId), count + 1)
    return { allowed: true, limit, remaining: limit - count - 1 }
  })
}

const message = (overrides: Partial<Anthropic.Message> = {}): Anthropic.Message =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Capacity is the maximum number of confirmed attendees, ', citations: null },
      { type: 'text', text: 'at least 1.', citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...overrides,
  }) as unknown as Anthropic.Message

function fakeClient(impl: (body: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }) => Promise<unknown>) {
  const create = vi.fn(impl)
  return { client: { messages: { create } } as unknown as MessagesClient, create }
}

function makeHandler(overrides: Partial<FieldHelpDeps> = {}) {
  const fake = fakeClient(async () => message())
  const deps: FieldHelpDeps = {
    getAssistant: () => ({ client: fake.client, model: 'claude-opus-5-5' }),
    buildContext: vi.fn(async () => CONTEXT),
    consumeQuota: memoryQuota(),
    ...overrides,
  }
  return { handler: createFieldHelpHandler(deps), deps, create: fake.create }
}

const withClient = (impl: Parameters<typeof fakeClient>[0]) => {
  const fake = fakeClient(impl)
  return { getAssistant: () => ({ client: fake.client, model: 'claude-opus-5-5' }), create: fake.create }
}

describe('POST /api/field-help', () => {
  it('answers from the text blocks, using server-built context and the request shape we expect', async () => {
    const { handler, deps, create } = makeHandler()
    const response = await handler(makeReq(valid))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      answer: 'Capacity is the maximum number of confirmed attendees, at least 1.',
      remaining: 19,
    })
    expect(deps.buildContext).toHaveBeenCalledWith(expect.anything(), 'sessions')

    expect(create).toHaveBeenCalledTimes(1)
    const [body, options] = create.mock.calls[0]
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'What does capacity mean?' }],
    })
    expect(typeof body.system).toBe('string')
    const systemText = body.system as string
    expect(systemText.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(systemText).toContain('Maximum number of confirmed attendees.')
    expect(systemText).toContain('Capacity cannot be lowered below the number of confirmed registrations.')
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'cache_control']) expect(body).not.toHaveProperty(key)
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('ignores any context the client tries to send', async () => {
    const { handler, create } = makeHandler()
    await handler(makeReq({ ...valid, context: 'capacity can be 0', fields: [{ name: 'secret' }] }))
    const systemText = create.mock.calls[0][0].system as string
    expect(systemText).not.toContain('capacity can be 0')
    expect(systemText).not.toContain('secret')
  })

  it('returns a calm 200 message when the model refuses', async () => {
    const assistant = withClient(async () =>
      message({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: null, explanation: null } as never }),
    )
    const response = await makeHandler(assistant).handler(makeReq(valid))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ answer: REFUSAL_ANSWER, refused: true })
  })

  it('returns 503 assistant_disabled when no API key is configured, without any client call', async () => {
    const { handler, create } = makeHandler({ getAssistant: () => null })
    const response = await handler(makeReq(valid))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'assistant_disabled' })
    expect(create).not.toHaveBeenCalled()
  })

  it('returns 503 assistant_disabled and logs when Anthropic rejects the key', async () => {
    const assistant = withClient(async () => {
      throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers())
    })
    const req = makeReq(valid)
    const response = await makeHandler(assistant).handler(req)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'assistant_disabled' })
    expect(req.payload.logger.error).toHaveBeenCalled()
  })

  it.each([
    ['SDK timeout', () => new Anthropic.APIConnectionTimeoutError()],
    ['connection error', () => new Anthropic.APIConnectionError({ message: 'fetch failed' })],
    ['rate limit', () => new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers())],
    ['overloaded', () => new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers())],
    ['other API error', () => new Anthropic.BadRequestError(400, undefined, 'bad request', new Headers())],
  ])('returns 503 assistant_unavailable on %s', async (_name, makeError) => {
    const assistant = withClient(async () => {
      throw makeError()
    })
    const response = await makeHandler(assistant).handler(makeReq(valid))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'assistant_unavailable' })
  })

  it('aborts a hanging call at the overall time limit and reports unavailable', async () => {
    const assistant = withClient(
      (_body, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()))
        }),
    )
    const started = Date.now()
    const response = await makeHandler({ ...assistant, overallTimeoutMs: 30 }).handler(makeReq(valid))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'assistant_unavailable' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('treats a max_tokens stop with no text as unavailable', async () => {
    const assistant = withClient(async () =>
      message({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '', signature: 's' }] as never }),
    )
    const response = await makeHandler(assistant).handler(makeReq(valid))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'assistant_unavailable' })
  })

  it('rate limits at 20 questions per user per hour', async () => {
    const { handler, create } = makeHandler()
    for (let i = 0; i < 20; i++) {
      expect((await handler(makeReq(valid))).status).toBe(200)
    }
    const limited = await handler(makeReq(valid))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('3600')
    expect((await limited.json()).error).toBe('rate_limited')
    expect(create).toHaveBeenCalledTimes(20)
    expect((await handler(makeReq(valid, { ...staff, id: 99 }))).status).toBe(200)
  })

  it.each([
    ['empty question', { collection: 'sessions', question: '   ' }],
    ['question over 500 chars', { collection: 'sessions', question: 'x'.repeat(501) }],
    ['collection not on the allowlist', { collection: 'payload-preferences', question: 'hi' }],
    ['missing collection', { question: 'hi' }],
  ])('returns 400 for invalid input: %s', async (_name, body) => {
    const { handler, create } = makeHandler()
    const response = await handler(makeReq(body))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_request')
    expect(create).not.toHaveBeenCalled()
  })

  it('returns 400 for a body that is not JSON', async () => {
    const response = await makeHandler().handler(makeReq('{not json'))
    expect(response.status).toBe(400)
  })

  it('requires a signed-in user with a role', async () => {
    expect((await makeHandler().handler(makeReq(valid, null))).status).toBe(401)
    expect((await makeHandler().handler(makeReq(valid, { id: 5, collection: 'users' }))).status).toBe(403)
  })

  it('returns 403 when the user may not read that collection (no context)', async () => {
    const { handler } = makeHandler({ buildContext: vi.fn(async () => null) })
    const response = await handler(makeReq({ collection: 'users', question: 'Who is admin?' }))
    expect(response.status).toBe(403)
  })
})
