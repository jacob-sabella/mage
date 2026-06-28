import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('New clears the in-progress deck after confirm', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.locator('.deck-entry')).toHaveCount(0)
  await expect(page.getByText(/No cards yet/)).toBeVisible()
})
