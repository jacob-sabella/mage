import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Copy decklist writes the deck as text to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.locator('tr', { hasText: 'Lightning Bolt' }).getByRole('button', { name: '+ Add' }).click()
  await page.getByRole('button', { name: 'Copy decklist' }).click()
  await expect(page.getByText('Decklist copied to clipboard')).toBeVisible()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('1 Lightning Bolt')
})
