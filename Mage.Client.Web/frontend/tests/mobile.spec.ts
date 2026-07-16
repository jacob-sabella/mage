import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.use({ viewport: { width: 390, height: 844 } })

test('deck editor stacks to a single column on mobile', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  const cols = await page.getByTestId('deck-builder').evaluate((e) => getComputedStyle(e).gridTemplateColumns)
  expect(cols.trim().split(/\s+/)).toHaveLength(1) // single column
})

test('in-game chat drops below the board on mobile', async ({ page }) => {
  await gotoScreen(page, 'game')
  const dir = await page.locator('.lobby-body').evaluate((e) => getComputedStyle(e).flexDirection)
  expect(dir).toBe('column')
})

test('focus-board toggle enters the immersive HUD (chrome hidden, life as a HUD)', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.locator('.player-strip')).toBeVisible()
  await page.locator('.focus-toggle').click()
  await expect(page.locator('html')).toHaveClass(/board-focus/)
  // immersive: the website chrome is hidden and the board fills the screen…
  await expect(page.locator('.app-nav')).toBeHidden()
  // …but player life stays on screen as a compact HUD (just without the counts)
  await expect(page.locator('.player-strip')).toBeVisible()
  await expect(page.locator('.pstat-counts').first()).toBeHidden()
})

test('chat starts collapsed on mobile to free space for the board', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.locator('.chat-col')).toHaveCount(0)
  await expect(page.locator('.chat-reopen')).toHaveCount(1)
})
