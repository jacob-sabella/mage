import { defineConfig, devices } from '@playwright/test'

// Integration tests drive the built app in a real (headless) browser against a
// faux backend (see tests/harness.ts) — deterministic, no gateway/server needed.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/e2e/**',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // software WebGL so the three.js board renders headless
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
        },
      },
    },
    {
      // real end-to-end: drives the live gateway+server on :8090
      // (`npm run test:e2e`). Skips itself if the gateway isn't reachable.
      name: 'e2e',
      testMatch: '**/e2e/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:8090',
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
        },
      },
    },
  ],
  // build the app and serve it statically (vite preview honours the configured outDir)
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
