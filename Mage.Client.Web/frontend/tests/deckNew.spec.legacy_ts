import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('New clears the in-progress deck after confirm', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toBeVisible()
  // New now asks via an in-app dialog; cancel keeps the deck, confirm clears it
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toBeVisible()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.confirm-overlay').getByRole('button', { name: 'New deck' }).click()
  await expect(page.locator('.deck-entry')).toHaveCount(0)
  await expect(page.getByText(/No cards yet/)).toBeVisible()
})
