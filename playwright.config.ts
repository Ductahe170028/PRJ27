import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: 'npm run test:server -w @game-creator/api',
      url: 'http://127.0.0.1:3101/api/health',
      reuseExistingServer: false,
      timeout: 20_000,
      env: { HOST: '127.0.0.1', PORT: '3101' },
    },
    {
      command: 'npm run preview -w @game-creator/web -- --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 20_000,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3101', VITE_API_BASE_URL: '' },
    },
  ],
});
