import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('flags a non-basic card past the 4-copy limit', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  // add 5 Lightning Bolt (non-basic) → over the limit
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.getByText(/Over the 4-copy limit: Lightning Bolt/)).toBeVisible()
  await expect(page.locator('.deck-entry.over-limit')).toHaveCount(1)
  // basics are exempt: 6 Mountain is fine
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Add Mountain' }).click()
  await expect(page.getByText(/Over the 4-copy limit: Lightning Bolt$/)).toBeVisible()
})
