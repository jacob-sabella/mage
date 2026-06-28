import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('switch between gallery and table views; add from table', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.locator('.card-grid')).toBeVisible()
  await page.getByRole('button', { name: /Table/ }).click()
  await expect(page.locator('.deck-table')).toBeVisible()
  await expect(page.locator('.card-grid')).toHaveCount(0)
  // add a card from the table row
  await page.locator('.deck-table tr', { hasText: 'Lightning Bolt' }).getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toBeVisible()
  // back to gallery
  await page.getByRole('button', { name: /Gallery/ }).click()
  await expect(page.locator('.card-grid')).toBeVisible()
})
