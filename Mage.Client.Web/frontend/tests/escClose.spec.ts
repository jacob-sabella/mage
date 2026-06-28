import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Escape closes the report modal', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Report problem' }).click()
  await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Report a problem' })).toHaveCount(0)
})
