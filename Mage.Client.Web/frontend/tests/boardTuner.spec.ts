import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

/* The ⚙ board tuner: live layout sliders floating over the board. */

const cardX = (page: import('@playwright/test').Page, id: string) =>
  page.evaluate((cid) => {
    const c = (window as { __board3d?: { rendered(): { id: string; x: number }[] } }).__board3d
      ?.rendered()
      .find((r) => r.id === cid)
    return c?.x ?? null
  }, id)

test('tuner opens over the board and the spacing slider moves cards live', async ({ page }) => {
  await gotoScreen(page, 'game')
  await page.waitForFunction(() => ((window as { __board3d?: { rendered(): unknown[] } }).__board3d?.rendered().length ?? 0) > 0)
  await page.locator('.tuner-fab').click()
  await expect(page.locator('.tuner-panel')).toBeVisible()
  // widen card spacing → track an off-centre card in a multi-card row (the
  // opponent's third creature): more spacing moves it outward on screen
  const before = await cardX(page, 'a4')
  await page.locator('.tuner-row', { hasText: 'Card spacing' }).locator('input').fill('1.4')
  await expect
    .poll(async () => {
      const after = await cardX(page, 'a4')
      return before != null && after != null ? Math.abs(after - before) : 0
    })
    .toBeGreaterThan(2)
  // the pref persisted (Settings page shares it)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mage.prefs') || '{}').cardGap)
  expect(stored).toBeCloseTo(1.4)
})

test('card size and row spacing sliders exist with sane ranges and reset restores 100%', async ({ page }) => {
  await gotoScreen(page, 'game')
  await page.locator('.tuner-fab').click()
  for (const label of ['Card size', 'Card spacing', 'Row spacing', 'Mat width', 'Mat depth', 'Table spread']) {
    await expect(page.locator('.tuner-row', { hasText: label })).toBeVisible()
  }
  await page.locator('.tuner-row', { hasText: 'Card size' }).locator('input').fill('1.4')
  await page.locator('.tuner-row', { hasText: 'Row spacing' }).locator('input').fill('1.5')
  await page.getByRole('button', { name: 'Reset layout' }).click()
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('mage.prefs') || '{}'))
  expect(prefs.cardScale).toBe(1)
  expect(prefs.rowGap).toBe(1)
})
