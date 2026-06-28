import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Sample hand draws 7 cards from the deck', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  // load a real deck (Mono Red Aggro, stubbed) so there are 7+ cards
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
  await page.getByRole('button', { name: 'Sample hand' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sample hand' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.sample-card')).toHaveCount(7)
  await dialog.getByRole('button', { name: 'New hand' }).click()
  await expect(dialog.locator('.sample-card')).toHaveCount(7)
})
