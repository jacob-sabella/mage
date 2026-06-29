import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

// Creating a game now goes through the TableSetup configuration screen.
test.describe('New game setup', () => {
  test('lists decks and filters by search', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'New game', exact: true }).click()

    await expect(page.getByRole('button', { name: /Mono Red Aggro/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Azorius Control/ })).toBeVisible()

    await page.getByPlaceholder('Search decks…').fill('azorius')
    await expect(page.getByRole('button', { name: /Azorius Control/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Mono Red Aggro/ })).toHaveCount(0)
  })

  test('picking a deck and starting creates a game with that deck', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let createdWith: string | null = null
    await page.route('**/api/tables/create', async (route) => {
      createdWith = JSON.parse(route.request().postData() || '{}').deckPath
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'g-1', started: true, openSeats: 0 }) })
    })
    await page.getByRole('button', { name: 'New game', exact: true }).click()
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
    await page.getByRole('button', { name: 'Start game' }).click()

    await expect.poll(() => createdWith).toBe('/decks/red.dck')
  })

  test('Free For All with AI opponents sends that many AI seats', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let body: { aiOpponents?: number; gameType?: string; openSeats?: number } = {}
    await page.route('**/api/tables/create', async (route) => {
      body = JSON.parse(route.request().postData() || '{}')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'g-1', started: true, openSeats: 0 }) })
    })
    await page.getByRole('button', { name: 'New game', exact: true }).click()
    // a larger format unlocks more AI seats
    await page.locator('.ts-field', { hasText: 'Format' }).locator('select').selectOption('Free For All')
    const moreAi = page.getByRole('button', { name: 'More AI opponents' })
    await moreAi.click() // 1 -> 2
    await moreAi.click() // 2 -> 3
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
    await page.getByRole('button', { name: 'Start game' }).click()

    await expect.poll(() => body.aiOpponents).toBe(3)
    expect(body.gameType).toBe('Free For All')
  })

  test('opening a table with an open seat shows the waiting room', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.route('**/api/tables/create', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 't-9', started: false, openSeats: 1 }) }),
    )
    await page.getByRole('button', { name: 'New game', exact: true }).click()
    // free the lone opponent seat from AI, then make it an open human seat
    await page.getByRole('button', { name: 'Fewer AI opponents' }).click() // 1 -> 0
    await page.getByRole('button', { name: 'More Open seats (humans)' }).click() // 0 -> 1
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
    await page.getByRole('button', { name: 'Create table' }).click()

    await expect(page.locator('.waiting-room')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible()
  })
})
