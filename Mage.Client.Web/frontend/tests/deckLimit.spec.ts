import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('flags copies beyond the format limit and exempts basics', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  // Freeform has no copy cap, so we can stack copies…
  await page.getByLabel('Deck format').selectOption('freeform')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('3×')
  // …then switching to a singleton format flags the extras
  await page.getByLabel('Deck format').selectOption('commander')
  await expect(page.getByText(/Singleton — extra copies of Lightning Bolt/)).toBeVisible()
  await expect(page.locator('.deck-entry.over-limit')).toHaveCount(1)
  // basics stay exempt even under singleton
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Add Mountain' }).click()
  await expect(page.locator('.deck-entry.over-limit')).toHaveCount(1)
})
