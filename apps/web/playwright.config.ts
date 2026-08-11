// @ts-nocheck
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT || 4321);
/**
 * preview (default) = production bundle — historically green while `astro dev` was broken.
 * `WEB_E2E_SERVER=dev` (via `bun run web:e2e:dev`) exercises the Vite client optimizer path.
 */
const serverMode = (process.env.WEB_E2E_SERVER || 'preview').toLowerCase();
const webServerCommand =
  serverMode === 'dev'
    ? `bun run dev -- --host 127.0.0.1 --port ${PORT}`
    : `bun run preview -- --host 127.0.0.1 --port ${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse a random local server in CI. Locally, prefer an explicit server
    // matching WEB_E2E_SERVER so a broken `astro dev` cannot masquerade as preview.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
