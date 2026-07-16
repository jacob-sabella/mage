import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('the active tab is remembered across a reload', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.getByTestId('deck-builder')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('deck-builder')).toBeVisible()
})
