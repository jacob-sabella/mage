import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('the stack panel lists pending spells with the top marked "next"', async ({ page }) => {
  await gotoScreen(page, 'stack')
  const panel = page.locator('.stack-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.stack-title')).toContainText('Stack (2)')
  // last-added resolves first → Counterspell is on top, tagged "next"
  const first = panel.locator('.stack-item').first()
  await expect(first).toContainText('Counterspell')
  await expect(first.locator('.stack-next-tag')).toBeVisible()
})
