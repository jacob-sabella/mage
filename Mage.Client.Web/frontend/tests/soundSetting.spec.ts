import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Settings has a sound-effects toggle (off by default)', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Settings' }).click()
  const row = page.locator('.setting-row', { hasText: 'Sound effects' })
  await expect(row).toBeVisible()
  const cb = row.locator('input[type=checkbox]')
  await expect(cb).not.toBeChecked()
  await cb.check()
  await expect(cb).toBeChecked()
})
