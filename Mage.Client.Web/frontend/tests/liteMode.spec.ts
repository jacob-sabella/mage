import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Reduce motion drops the animated 3D backdrop', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await expect(page.locator('.scene-bg')).toHaveCount(1)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Reduce motion').click()
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
  await expect(page.locator('.scene-bg')).toHaveCount(0)
})
