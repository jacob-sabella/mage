import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('"/" focuses the card search in the deck editor', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.locator('.deck-stats, .deck-list-body').first().click({ force: true }) // blur any input
  await page.keyboard.press('/')
  const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement)?.placeholder || '')
  expect(focused).toContain('Search')
})
