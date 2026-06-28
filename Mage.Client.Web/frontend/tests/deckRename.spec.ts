import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('the deck name is editable inline', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  const title = page.getByLabel('Deck name')
  await expect(title).toHaveValue('My Deck')
  await title.fill('Mono Red Burn')
  await expect(title).toHaveValue('Mono Red Burn')
})
