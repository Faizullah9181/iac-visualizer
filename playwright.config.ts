import { defineConfig, devices } from '@playwright/test';

const PORT = 5792;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1480, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1480, height: 900 } } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
