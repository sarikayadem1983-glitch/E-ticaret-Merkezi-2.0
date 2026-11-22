import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the running stack: backend on :4000 (`npm run start`
 * in backend/) and this app on :3000 (`npm run dev`), plus Postgres and Redis.
 */
// Production build behind a local TLS proxy with a throwaway certificate (e2e/run-prod.sh).
const tls = process.env.E2E_BASE_URL?.startsWith('https://localhost:') ?? false;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: tls ? 60_000 : 120_000,
  // `next dev` compiles a page on first visit; 5 s is too short on slow machines.
  expect: { timeout: tls ? 5_000 : 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    ignoreHTTPSErrors: tls,
    trace: 'retain-on-failure',
    locale: 'tr-TR',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
});
