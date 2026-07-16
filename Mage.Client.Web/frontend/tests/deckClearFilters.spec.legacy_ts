import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Clear resets the deck-builder filters', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.locator('.filter-pip', { hasText: 'R' }).click()
  await page.locator('.filter-cmc').fill('3')
  const clear = page.getByRole('button', { name: /Clear/ })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(page.locator('.filter-cmc')).toHaveValue('')
  await expect(clear).toHaveCount(0)
})
