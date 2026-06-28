import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Toasts', () => {
  test('entering a game where it is your turn shows a "Your turn" toast', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.locator('.toast', { hasText: 'Your turn' })).toBeVisible()
  })
})
