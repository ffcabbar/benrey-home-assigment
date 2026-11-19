import { parse } from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

export const E2E_PORT = 3100
export const E2E_URL = `http://localhost:${E2E_PORT}`
export const E2E_STATE_DIR = path.resolve('.e2e')
export const E2E_CREDENTIALS_FILE = path.join(E2E_STATE_DIR, 'credentials.json')

const readEnvFile = (file: string): Record<string, string> =>
  fs.existsSync(file) ? parse(fs.readFileSync(file)) : {}

/**
 * The environment for the E2E server and its fixture script, built from the local `.env` only.
 *
 * `next start` also loads `.env.production.local`, which may hold production credentials. Next
 * never overrides a variable that is already set (even to ""), so every name found in any env
 * file is set here explicitly. The database name must end in `_e2e`, and there is no AI key:
 * the tests stub `/api/field-help`.
 */
export function e2eEnv(): Record<string, string> {
  const local = readEnvFile('.env')
  const everyName = new Set(
    fs
      .readdirSync('.')
      .filter((file) => file.startsWith('.env'))
      .flatMap((file) => Object.keys(readEnvFile(file))),
  )

  const devUrl = local.DATABASE_URL ?? 'postgres://benrey:benrey_local_only@localhost:54329/benrey'
  const databaseUrl = process.env.E2E_DATABASE_URL ?? devUrl.replace(/\/([^/?]+)(\?.*)?$/, '/$1_e2e$2')
  assertE2EDatabase(databaseUrl)
  assertLocalHost('S3_ENDPOINT', local.S3_ENDPOINT ?? '')

  const env: Record<string, string> = Object.fromEntries([...everyName].map((name) => [name, '']))
  for (const name of ['PAYLOAD_SECRET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE']) {
    env[name] = local[name] ?? ''
  }
  return {
    ...env,
    DATABASE_URL: databaseUrl,
    S3_BUCKET: process.env.E2E_S3_BUCKET ?? 'benrey-media-test',
    NEXT_PUBLIC_SERVER_URL: E2E_URL,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    PAYLOAD_MIGRATE_ON_INIT: '',
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The E2E run wipes its database and writes to its bucket, so both must be local Docker services. */
function assertLocalHost(what: string, url: string) {
  const host = URL.canParse(url) ? new URL(url).hostname : ''
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run E2E tests: ${what} must point at localhost (docker compose), not "${host}".`)
  }
}

export function assertE2EDatabase(databaseUrl: string) {
  assertLocalHost('DATABASE_URL', databaseUrl)
  const name = new URL(databaseUrl).pathname.slice(1)
  if (!name.endsWith('_e2e')) {
    throw new Error(`Refusing to use database "${name}" for E2E tests: its name must end in _e2e.`)
  }
}
