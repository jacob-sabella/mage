import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Keyboard shortcuts overlay', () => {
  test('? opens the overlay, Escape closes it', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.locator('.brand-name').click() // blur any autofocused input first
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await expect(page.getByText('Skip until my turn')).toBeVisible()
    // newer shortcuts are documented too
    await expect(page.getByText('Move between hand cards')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  })

  test('the help button opens it too', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.locator('.help-fab').click()
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  })
})
