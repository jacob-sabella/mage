import { test, expect } from '@playwright/test'
import { gotoScreen, installMocks } from './harness'

test.describe('Settings', () => {
  test('card-images preference toggles and persists across reload', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()

    const toggle = page.locator('.setting-row', { hasText: 'Card images' }).locator('input[type="checkbox"]')
    await expect(toggle).toBeChecked() // default on
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()

    // persists in localStorage -> still off after a reload
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(
      page.locator('.setting-row', { hasText: 'Card images' }).locator('input[type="checkbox"]'),
    ).not.toBeChecked()
  })

  test('settings accessible without connecting to a server', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')
    // Login form is visible (not connected)
    await expect(page.getByRole('button', { name: /connect/i })).toBeVisible()
    // Settings tab is visible pre-login
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
    // Navigate to settings without connecting
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()
    // Can still navigate back to the login screen
    await page.getByRole('button', { name: 'Play' }).click()
    await expect(page.getByRole('button', { name: /connect/i })).toBeVisible()
  })
})
