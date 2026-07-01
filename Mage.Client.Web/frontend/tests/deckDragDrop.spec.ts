import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('dragging a search result onto the deck panel adds it', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  // gallery is the default view — each result is a draggable .card-tile
  const tile = page.locator('.card-tile', { hasText: 'Lightning Bolt' })
  await expect(tile).toBeVisible()
  await tile.dragTo(page.locator('.deck-list'))
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('1×')
  // dropping again adds a second copy
  await tile.dragTo(page.locator('.deck-list'))
  await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('2×')
})
