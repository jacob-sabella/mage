import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Booster draft', () => {
  test('shows the booster pack and your picks', async ({ page }) => {
    await gotoScreen(page, 'draft')
    await expect(page.getByRole('heading', { name: 'Booster Draft' })).toBeVisible()
    // current pack
    await expect(page.locator('.draft-card', { hasText: 'Loxodon Line Breaker' })).toBeVisible()
    await expect(page.locator('.draft-card', { hasText: 'Disperse' })).toBeVisible()
    // already-picked pile
    await expect(page.locator('.draft-pick-chip', { hasText: 'Goblin Instigator' })).toBeVisible()
  })

  test('clicking a card sends a pick for that card', async ({ page }) => {
    await gotoScreen(page, 'draft')
    let pickedId: string | null = null
    await page.route('**/api/draft/pick', (route) => {
      pickedId = JSON.parse(route.request().postData() || '{}').cardId
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('.draft-card', { hasText: 'Trumpet Blast' }).click()
    await expect.poll(() => pickedId).toBe('d3')
  })

  test('Draft vs AI button starts a draft', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let started = false
    await page.route('**/api/draft/create', (route) => {
      started = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'd-1' }) })
    })
    await page.getByRole('button', { name: 'Draft vs AI' }).click()
    await expect.poll(() => started).toBe(true)
  })
})
