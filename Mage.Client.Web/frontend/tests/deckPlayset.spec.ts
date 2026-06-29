import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('shift-click adds a playset of 4', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('4×')
  // plain click still adds one (tops past 4)
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('5×')
})
