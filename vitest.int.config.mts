import { config as loadDotenv } from 'dotenv'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

loadDotenv()

const devUrl = process.env.DATABASE_URL ?? 'postgres://benrey:benrey_local_only@localhost:54329/benrey'
const testUrl = process.env.TEST_DATABASE_URL ?? devUrl.replace(/\/([^/?]+)(\?.*)?$/, '/$1_test$2')
const testDbName = new URL(testUrl).pathname.slice(1)
if (!testDbName.endsWith('_test')) {
  throw new Error(`Refusing to run integration tests against "${testDbName}": the database name must end in _test.`)
}

const testEnv = {
  DATABASE_URL: testUrl,
  S3_BUCKET: process.env.TEST_S3_BUCKET ?? 'benrey-media-test',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_AUTH_TOKEN: '',
}
// globalSetup runs in this process and test files in workers: both need the test env.
Object.assign(process.env, testEnv)

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/int/**/*.int.test.ts'],
    globalSetup: ['tests/int/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Payload's postgres adapter keeps one pool client checked out, so workers can't exit alone.
    teardownTimeout: 2_000,
    env: testEnv,
  },
})
