import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('Goldfish deals 7, draws through turns, and mulligans with London bottoming', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  // load a real deck (Mono Red Aggro, stubbed) so there are plenty of cards
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
  await page.getByRole('button', { name: 'Goldfish (playtest)' }).click()

  const dialog = page.getByRole('dialog', { name: 'Goldfish playtest' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.sample-card')).toHaveCount(7)
  await expect(dialog).toContainText('Turn 1')

  // Draw grows the hand; Next turn bumps the turn and also draws
  await dialog.getByRole('button', { name: 'Draw', exact: true }).click()
  await expect(dialog.locator('.sample-card')).toHaveCount(8)
  await dialog.getByRole('button', { name: 'Next turn' }).click()
  await expect(dialog).toContainText('Turn 2')
  await expect(dialog.locator('.sample-card')).toHaveCount(9)

  // Mulligan → new 7, owe 1 to the bottom; Draw is blocked until it's paid
  await dialog.getByRole('button', { name: 'Mulligan' }).click()
  await expect(dialog).toContainText('Mulligan 1')
  await expect(dialog.locator('.sample-card')).toHaveCount(7)
  await expect(dialog.getByText(/Put 1 card on the bottom/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Draw', exact: true })).toBeDisabled()
  await dialog.locator('.sample-card').first().click() // bottom one
  await expect(dialog.locator('.sample-card')).toHaveCount(6)
  await expect(dialog.getByRole('button', { name: 'Draw', exact: true })).toBeEnabled()
})
