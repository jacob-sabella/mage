import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'
test('shot: deck editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.getByRole('button', { name: 'Add Mountain' }).click()
  await page.getByRole('button', { name: 'Add Mountain' }).click()
  await page.getByRole('button', { name: 'Add Forest' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/claude-1000/-home-jsabella-Projects-mage/096da236-07e3-4a76-b2b6-99eee7e25516/scratchpad/deck.png' })
})
