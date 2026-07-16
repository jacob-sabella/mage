import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('shift-click adds a playset of 4, and constructed caps there', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('4×')
  // the constructed 4-copy cap holds — a further add does not exceed it
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('4×')
})
