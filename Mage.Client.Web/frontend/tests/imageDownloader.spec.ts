import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Settings can start an image download and shows progress', async ({ page }) => {
  await page.route('**/api/images/stats', (r) =>
    r.fulfill({ json: { available: true, dir: '/app/images', files: 1000, sets: 50, bytes: 5e8, sources: ['Scryfall'] } }),
  )
  await page.route('**/api/images/download', (r) => r.fulfill({ json: { started: true, message: 'scanning…' } }))
  let polls = 0
  await page.route('**/api/images/download/progress', (r) => {
    polls++
    const running = polls < 2
    r.fulfill({ json: { running, cancelled: false, scanned: 120, candidates: 10, done: running ? 4 : 10, failed: 0, skipped: 110, current: running ? 'Lightning Bolt (LEA)' : '', message: running ? 'scanning…' : 'done — 10 downloaded, 0 failed' } })
  })
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Download missing art' }).click()
  await expect(page.getByText(/fetching Lightning Bolt/)).toBeVisible()
  await expect(page.locator('.img-progress-fill')).toBeVisible()
  // completes
  await expect(page.getByText(/done — 10 downloaded/)).toBeVisible({ timeout: 5000 })
})
