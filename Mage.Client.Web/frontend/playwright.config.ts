import { existsSync } from 'fs'
import { defineConfig, devices } from '@playwright/test'

// Pre-installed chromium in the Claude Code remote execution environment.
// On real CI runners this path won't exist, so fall back to the Playwright-installed binary.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium'
const localChromiumPath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined

// Integration tests drive the built app in a real (headless) browser against a
// faux backend (see tests/harness.ts) — deterministic, no gateway/server needed.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // retry once everywhere — the software-WebGL 3D board tests are occasionally
  // timing-flaky; a real failure still fails both attempts
  retries: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // CLIPS=1 records a small video per test (see scripts/build-clips.mjs), which
    // packages them into the app as a viewable gallery. Off for normal runs.
    video: process.env.CLIPS ? { mode: 'on', size: { width: 720, height: 450 } } : 'off',
  },
  // html2canvas screenshot capture (async) can take several seconds before the
  // report modal opens — use a generous assertion timeout to avoid flaky tests.
  expect: { timeout: 15000 },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/e2e/**',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(localChromiumPath ? { executablePath: localChromiumPath } : {}),
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
