import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Deck picker', () => {
  test('lists decks and filters by search', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'New game vs AI' }).click()

    await expect(page.getByRole('button', { name: /Mono Red Aggro/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Azorius Control/ })).toBeVisible()

    await page.getByPlaceholder('Search decks…').fill('azorius')
    await expect(page.getByRole('button', { name: /Azorius Control/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Mono Red Aggro/ })).toHaveCount(0)
  })

  test('picking a deck triggers create-game with that deck', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    // register AFTER the harness so this handler wins for the create call
    let createdWith: string | null = null
    await page.route('**/api/tables/create', async (route) => {
      createdWith = JSON.parse(route.request().postData() || '{}').deckPath
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'g-1' }) })
    })
    await page.getByRole('button', { name: 'New game vs AI' }).click()
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()

    await expect.poll(() => createdWith).toBe('/decks/red.dck')
  })

  test('selecting opponents creates a free-for-all with that many AIs', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let opponents: number | null = null
    await page.route('**/api/tables/create', async (route) => {
      opponents = JSON.parse(route.request().postData() || '{}').opponents
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'g-1' }) })
    })
    await page.getByRole('button', { name: 'New game vs AI' }).click()
    // pick 3 AI opponents, then a deck
    await page.locator('.opp-btn', { hasText: '3' }).click()
    await expect(page.getByText(/Free-for-all · 4 players/)).toBeVisible()
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()

    await expect.poll(() => opponents).toBe(3)
  })
})
