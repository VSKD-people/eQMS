// Browser test of the pilot stack (docker-compose.pilot.yml, port 3001). Run once on a fresh stack after the bootstrap
// script; see pilot/pilot.spec.ts for the environment variables it needs.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './pilot',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001', trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
