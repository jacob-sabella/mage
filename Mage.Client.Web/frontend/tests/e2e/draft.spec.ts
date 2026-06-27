import { test, expect } from '@playwright/test'

// Real booster draft through the live gateway + server. Skips if unreachable.
let up = false
test.beforeAll(async ({ request }) => {
  try {
    up = (await request.get('http://localhost:8090/', { timeout: 4000 })).ok()
  } catch {
    up = false
  }
})

test('real booster draft: a pack of real cards renders', async ({ page }) => {
  test.skip(!up, 'gateway not reachable on :8090')
  test.setTimeout(90_000)

  await page.addInitScript(() => localStorage.removeItem('mage.session'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Local', exact: true }).click()
  await page.getByPlaceholder(/Any name/).fill('draft' + (Date.now() % 100000))
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Draft vs AI' }).click()
  await expect(page.getByRole('heading', { name: 'Booster Draft' })).toBeVisible({ timeout: 45_000 })

  // the real first pack arrives (a booster is ~15 cards)
  await expect(page.locator('.draft-card').first()).toBeVisible({ timeout: 45_000 })
  expect(await page.locator('.draft-card').count()).toBeGreaterThan(5)

  // and a card is pickable → after picking, the next pack streams in
  await page.locator('.draft-card').first().click()
  await expect(page.locator('.draft-pick-chip').first()).toBeVisible({ timeout: 30_000 })
})
