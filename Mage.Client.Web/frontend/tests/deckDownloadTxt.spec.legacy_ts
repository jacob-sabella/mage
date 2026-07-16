import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Download .txt exports the decklist as a file', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await page.getByLabel('Deck name').fill('Burn')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .txt' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('Burn.txt')
})
