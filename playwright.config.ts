import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && node --disable-warning=ExperimentalWarning dist/server/server/index.js`,
    url: `http://localhost:${PORT}/api/health`,
    env: { PORT: String(PORT), SESSION_SECRET: 'e2e-secret-that-is-at-least-32-characters' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
