import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// Specs create users through the admin API and read Mailpit; keys come from .env.local.
config({ path: '.env.local', quiet: true });

/**
 * E2E: mobile (390px) and desktop projects, axe wired per spec. Runs against a production build
 * (`pnpm build` first) so CI and local behave the same. Set PW_DEV=1 to use the dev server.
 */
const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile',
      // Chromium with phone emulation (one browser to install in CI); 390px per DESIGN_SYSTEM.md.
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: process.env.PW_DEV ? `pnpm next dev -p ${port}` : `pnpm next start -p ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
