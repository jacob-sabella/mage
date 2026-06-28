import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

async function openDeckEditor(page: import('@playwright/test').Page) {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
}

test.describe('Deck editor', () => {
  test('auto-loads cards into the search results', async ({ page }) => {
    await openDeckEditor(page)
    await expect(page.getByRole('button', { name: 'Add Lightning Bolt' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Serra Angel' })).toBeVisible()
  })

  test('adding a card puts it in the deck with a quantity', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
    const entry = page.locator('.deck-entry', { hasText: 'Lightning Bolt' })
    await expect(entry).toBeVisible()
    await expect(entry).toContainText('1×')
  })

  test('Open loads a deck (cards, quantities, sideboard, stats)', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Open' }).click()
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()

    await expect(page.getByRole('heading', { name: 'Mono Red Aggro' })).toBeVisible()
    await expect(page.locator('.deck-entry', { hasText: 'Mountain' })).toContainText('20×')
    await expect(page.getByText(/Sideboard/)).toBeVisible()
    await expect(page.locator('.deck-stats')).toBeVisible()
  })
})
