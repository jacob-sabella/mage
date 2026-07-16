import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Add basics adds a basic land to the deck', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Mountain' }).click()
  await page.getByRole('button', { name: 'Add Mountain' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Mountain' })).toContainText('2×')
  await expect(page.locator('.deck-group-title', { hasText: 'Lands' })).toBeVisible()
})
