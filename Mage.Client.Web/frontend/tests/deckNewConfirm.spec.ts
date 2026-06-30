import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('New deck asks for confirmation when the deck is non-empty', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  // put something in the deck so New deck has something to clear
  await page.getByRole('button', { name: 'Add Mountain' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Mountain' })).toBeVisible()

  // New deck → styled confirm dialog (not native), deck still intact
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const dialog = page.locator('.confirm-overlay')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.deck-entry', { hasText: 'Mountain' })).toBeVisible()

  // confirm clears it
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.confirm-overlay').getByRole('button', { name: 'New deck' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Mountain' })).toHaveCount(0)
})
