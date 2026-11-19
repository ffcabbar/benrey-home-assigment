import { defineConfig, devices } from '@playwright/test'

import { E2E_PORT, E2E_URL, e2eEnv } from './tests/e2e/env'

// The E2E app runs as a production build on its own port and its own `_e2e` database, so it never
// touches `pnpm dev` on port 3000 or the dev data. The specs share one fixture and run in order.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: the specs share one fixture that is not reset between attempts.
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // To watch a run: E2E_SLOWMO=500 pnpm test:e2e --headed
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec tsx tests/e2e/prepare.ts && pnpm build && pnpm exec next start -p ${E2E_PORT}`,
    url: `${E2E_URL}/admin/login`,
    env: e2eEnv(),
    reuseExistingServer: false,
    timeout: 6 * 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
