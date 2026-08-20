import { defineConfig, devices } from '@playwright/test'

// The smoke suite runs against the PRODUCTION build (vite preview), not the dev
// server, so it exercises exactly what deploy.sh uploads. Port 4173 keeps it
// clear of the dev server on 5173.
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  // A full scenario playthrough includes a real ~15s simulation run.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
