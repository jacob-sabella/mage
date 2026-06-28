import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('tapping a deck entry shows its preview (touch-friendly)', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await page.locator('.deck-entry', { hasText: 'Lightning Bolt' }).click({ force: true })
  await expect(page.locator('.card-preview-name')).toHaveText('Lightning Bolt')
})
