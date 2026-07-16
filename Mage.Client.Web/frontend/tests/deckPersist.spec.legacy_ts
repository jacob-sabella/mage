import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('deck editor auto-saves the in-progress deck across a reload', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toBeVisible()
})
