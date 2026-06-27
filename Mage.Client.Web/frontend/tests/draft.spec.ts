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

  test('after the draft, the construct screen builds + submits a deck', async ({ page }) => {
    await gotoScreen(page, 'construct')
    await expect(page.getByRole('heading', { name: 'Build your deck' })).toBeVisible()
    // Submit disabled until the deck has 40+ cards
    const submit = page.getByRole('button', { name: /Submit/ })
    await expect(submit).toBeDisabled()
    // Auto-build selects the pool + a manabase to reach 40
    await page.getByRole('button', { name: 'Auto-build' }).click()
    await expect(page.locator('.chip', { hasText: /cards/ })).not.toHaveClass(/under/)
    await expect(submit).toBeEnabled()

    let submittedTo: string | null = null
    await page.route('**/api/draft/submit', (route) => {
      submittedTo = JSON.parse(route.request().postData() || '{}').tableId
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await submit.click()
    await expect.poll(() => submittedTo).toBe('t-draft')
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
