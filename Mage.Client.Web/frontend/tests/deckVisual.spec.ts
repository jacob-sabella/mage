import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('the maindeck can be viewed as a visual grid of card images', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.locator('.view-switch-btn', { hasText: 'Table' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] }) // 4-of

  // switch the deck panel from list to visual
  await page.locator('.deck-view-switch button', { hasText: 'Visual' }).click()
  await expect(page.locator('.deck-visual-card')).toHaveCount(1)
  await expect(page.locator('.deck-visual-card img')).toHaveAttribute('alt', 'Lightning Bolt')
  await expect(page.locator('.deck-visual-count')).toHaveText('4×')

  // the inline controls still work from the visual view
  await page.getByRole('button', { name: 'Decrease Lightning Bolt' }).click()
  await expect(page.locator('.deck-visual-count')).toHaveText('3×')

  // toggling back to list keeps the change + the choice persists
  await page.locator('.deck-view-switch button', { hasText: 'List' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('3×')
})
