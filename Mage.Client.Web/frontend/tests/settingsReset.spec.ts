import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Reset preferences restores defaults', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Settings' }).click()
  // turn off card images, then reset
  const cardImages = page.locator('.setting-row', { hasText: 'Card images' }).locator('input[type=checkbox]')
  await cardImages.uncheck()
  await expect(cardImages).not.toBeChecked()
  await page.getByRole('button', { name: 'Reset preferences' }).click()
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Reset' }).click()
  await expect(cardImages).toBeChecked() // default is on
})
