import { defineConfig } from '@playwright/test'

/**
 * E2E setup: spin up two local servers — Vite (with VITE_TEST_TOKEN +
 * VITE_WORKER_URL injected) and wrangler dev (the worker, in development
 * mode so it accepts `test_<userId>` Bearer tokens). With both running,
 * the browser hits the real auth + analyze + suggest + signaling stack.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5180/mallet/',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --port 5180',
      port: 5180,
      reuseExistingServer: true,
      timeout: 15000,
      env: {
        VITE_TEST_TOKEN: 'test_e2e',
        VITE_WORKER_URL: 'http://localhost:8787',
      },
    },
    {
      command: 'npm --prefix ../mallet-worker run dev -- --port 8787',
      port: 8787,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
