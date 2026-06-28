import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.use({ viewport: { width: 390, height: 844 } })

test('deck editor stacks to a single column on mobile', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  const dir = await page.locator('.deck-editor').evaluate((e) => getComputedStyle(e).flexDirection)
  expect(dir).toBe('column')
})

test('in-game chat drops below the board on mobile', async ({ page }) => {
  await gotoScreen(page, 'game')
  const dir = await page.locator('.lobby-body').evaluate((e) => getComputedStyle(e).flexDirection)
  expect(dir).toBe('column')
})

test('focus-board toggle hides the life strips for a full-screen board', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.locator('.player-strip')).toBeVisible()
  await page.locator('.focus-toggle').click()
  await expect(page.locator('html')).toHaveClass(/board-focus/)
  await expect(page.locator('.player-strip')).toBeHidden()
})

test('chat starts collapsed on mobile to free space for the board', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.locator('.chat-col')).toHaveCount(0)
  await expect(page.locator('.chat-reopen')).toHaveCount(1)
})
