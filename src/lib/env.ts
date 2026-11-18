import { z } from 'zod'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const required = (schema: z.ZodString = z.string()) =>
  z.preprocess(emptyToUndefined, schema.min(1))

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional())

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// connection string')

const serverSchema = z.object({
  DATABASE_URL: required(postgresUrl),
  PAYLOAD_SECRET: required(z.string().min(32, 'must be at least 32 characters')),
  S3_ENDPOINT: required(z.string().url('must be a URL, e.g. https://<project>.supabase.co/storage/v1/s3')),
  S3_REGION: required(),
  S3_BUCKET: required(),
  S3_ACCESS_KEY_ID: required(),
  S3_SECRET_ACCESS_KEY: required(),
  S3_FORCE_PATH_STYLE: optional(z.enum(['true', 'false'])),
  NEXT_PUBLIC_SERVER_URL: optional(z.string().url()),
  VERCEL_PROJECT_PRODUCTION_URL: optional(z.string()),
  ANTHROPIC_API_KEY: optional(z.string()),
  ANTHROPIC_MODEL: optional(z.string()),
  NODE_ENV: optional(z.enum(['development', 'production', 'test'])),
})

export type ServerEnv = z.infer<typeof serverSchema>

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      [
        'Invalid server environment. The app will not start until these are fixed:',
        ...issues.map((issue) => `  - ${issue}`),
        'See .env.example for what each variable means.',
      ].join('\n'),
    )
    this.name = 'EnvValidationError'
  }
}

export const isBuildPhase = (): boolean => process.env.NEXT_PHASE === 'phase-production-build'

export function parseServerEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => {
    const name = issue.path.join('.')
    const missing = source[name] === undefined || String(source[name]).trim() === ''
    return missing ? `${name} is required but missing` : `${name} ${issue.message}`
  })
  throw new EnvValidationError(issues)
}

const BUILD_PLACEHOLDERS: ServerEnv = {
  DATABASE_URL: 'postgres://build-placeholder:5432/none',
  PAYLOAD_SECRET: 'build-phase-placeholder-secret-not-used-at-runtime',
  S3_ENDPOINT: 'http://build-placeholder.invalid',
  S3_REGION: 'build-placeholder',
  S3_BUCKET: 'build-placeholder',
  S3_ACCESS_KEY_ID: 'build-placeholder',
  S3_SECRET_ACCESS_KEY: 'build-placeholder',
}

let cached: ServerEnv | undefined

// `next build` loads the config without runtime secrets, so the build gets placeholders;
// the real check runs at server boot (instrumentation.ts) and in every CLI, seed and test run.
export function getServerEnv(): ServerEnv {
  if (cached) return cached
  if (isBuildPhase()) {
    try {
      cached = parseServerEnv(process.env)
    } catch {
      return { ...BUILD_PLACEHOLDERS, NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL }
    }
    return cached
  }
  cached = parseServerEnv(process.env)
  return cached
}

export function getServerURL(env: ServerEnv): string {
  if (env.NEXT_PUBLIC_SERVER_URL) return env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, '')
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  return 'http://localhost:3000'
}

export type LLMConfig = { apiKey: string; model: string }

export function getLLMConfig(env: ServerEnv = getServerEnv()): LLMConfig | null {
  if (!env.ANTHROPIC_API_KEY) return null
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL }
}
