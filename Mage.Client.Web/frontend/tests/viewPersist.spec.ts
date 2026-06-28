import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('the active tab is remembered across a reload', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.locator('.deck-editor')).toBeVisible()
  await page.reload()
  await expect(page.locator('.deck-editor')).toBeVisible()
})
