import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Settings exposes the card/token image cache status', async ({ page }) => {
  await page.route('**/api/images/stats', (r) =>
    r.fulfill({ json: { available: true, dir: '/app/images', files: 12345, sets: 678, bytes: 9000000000, sources: ['Scryfall', 'Grabbag (tokens)'] } }),
  )
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Card & token images' })).toBeVisible()
  await expect(page.getByText('12,345')).toBeVisible()
  await expect(page.getByText(/Sources: Scryfall/)).toBeVisible()
})
