import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import { EnvValidationError, getLLMConfig, parseServerEnv, type ServerEnv } from '@/lib/env'

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  PAYLOAD_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
}

describe('parseServerEnv', () => {
  it('accepts a complete environment', () => {
    expect(parseServerEnv(valid).S3_BUCKET).toBe('bucket')
  })

  it('lists every missing required variable in one error', () => {
    try {
      parseServerEnv({})
      throw new Error('expected to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const message = (error as Error).message
      for (const name of Object.keys(valid)) expect(message).toContain(`${name} is required but missing`)
    }
  })

  it('treats empty strings (copied .env.example) as missing, including optional ones', () => {
    expect(() => parseServerEnv({ ...valid, S3_BUCKET: '  ' })).toThrow(/S3_BUCKET is required but missing/)
    const env = parseServerEnv({ ...valid, ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: ' ' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
  })

  it('rejects a non-Postgres database URL (no SQLite fallback)', () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: 'file:./local.db' })).toThrow(/DATABASE_URL must be a postgres/)
  })

  it('rejects a short secret', () => {
    expect(() => parseServerEnv({ ...valid, PAYLOAD_SECRET: 'short' })).toThrow(/PAYLOAD_SECRET/)
  })

  it('rejects the placeholder secret from .env.example, so a copied example cannot boot', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    const placeholder = /^PAYLOAD_SECRET=(.*)$/m.exec(example)?.[1]
    expect(placeholder).toBeDefined()
    expect(() => parseServerEnv({ ...valid, PAYLOAD_SECRET: placeholder })).toThrow(/PAYLOAD_SECRET must be at least 32 characters/)
  })
})

describe('getLLMConfig', () => {
  it('is null without ANTHROPIC_API_KEY (assistant disabled)', () => {
    expect(getLLMConfig(valid as ServerEnv)).toBeNull()
    expect(getLLMConfig({ ...valid, ANTHROPIC_MODEL: 'claude-opus-5-5' } as ServerEnv)).toBeNull()
  })

  it('defaults the model to claude-opus-5-5 and honours ANTHROPIC_MODEL', () => {
    expect(getLLMConfig({ ...valid, ANTHROPIC_API_KEY: 'k' } as ServerEnv)).toEqual({ apiKey: 'k', model: 'claude-opus-5-5' })
    expect(getLLMConfig({ ...valid, ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' } as ServerEnv)).toEqual({
      apiKey: 'k',
      model: 'claude-sonnet-5-5',
    })
  })
})
