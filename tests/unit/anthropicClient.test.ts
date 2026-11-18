import { beforeEach, describe, expect, it, vi } from 'vitest'

const constructed: unknown[] = []
vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = { create: vi.fn() }
    constructor(options: unknown) {
      constructed.push(options)
    }
  }
  return { default: FakeAnthropic }
})

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  PAYLOAD_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
}

describe('Anthropic client construction', () => {
  beforeEach(() => {
    constructed.length = 0
    vi.resetModules()
    vi.unstubAllEnvs()
    for (const [key, value] of Object.entries(baseEnv)) vi.stubEnv(key, value)
    vi.stubEnv('ANTHROPIC_MODEL', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'ambient-token-should-not-be-used')
  })

  it('never constructs a client when ANTHROPIC_API_KEY is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const { getAssistantFromEnv } = await import('@/ai/fieldHelp')
    expect(getAssistantFromEnv()).toBeNull()
    expect(constructed).toHaveLength(0)
  })

  it('passes the key explicitly with a 15 s timeout and one retry, and reuses the client', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key')
    const { getAssistantFromEnv } = await import('@/ai/fieldHelp')
    const first = getAssistantFromEnv()
    expect(first?.model).toBe('claude-opus-5-5')
    expect(constructed).toEqual([{ apiKey: 'sk-ant-test-key', timeout: 15_000, maxRetries: 1 }])
    expect(getAssistantFromEnv()).toBe(first)
    expect(constructed).toHaveLength(1)
  })
})
