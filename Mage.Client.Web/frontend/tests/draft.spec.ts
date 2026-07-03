import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Booster draft', () => {
  test('shows the booster pack and your picks', async ({ page }) => {
    await gotoScreen(page, 'draft')
    await expect(page.getByRole('heading', { name: 'Booster Draft' })).toBeVisible()
    // current pack
    await expect(page.locator('.draft-card', { hasText: 'Loxodon Line Breaker' })).toBeVisible()
    await expect(page.locator('.draft-card', { hasText: 'Disperse' })).toBeVisible()
    // already-picked pile renders card thumbnails (image + name), not text chips
    const pick = page.locator('.draft-pick-thumb', { hasText: 'Goblin Instigator' })
    await expect(pick).toBeVisible()
    await expect(pick.locator('img[alt="Goblin Instigator"]')).toBeVisible()
  })

  test('shows the pack/pick position header and a ticking pick timer', async ({ page }) => {
    await gotoScreen(page, 'draft')
    // "Pack 1 · Pick 2 — Core Set 2019" comes from the draft frame's DraftDto fields
    const pos = page.getByTestId('draft-position')
    await expect(pos).toContainText('Pack 1 · Pick 2')
    await expect(pos).toContainText('Core Set 2019')
    // the countdown starts from draft.timeout (75s) and ticks down
    const timer = page.locator('.draft-timer')
    await expect(timer).toBeVisible()
    await expect(timer).toContainText('1:1') // 75s → 1:15, ticking through 1:1x
    await expect(timer).not.toHaveClass(/urgent/) // red only at ≤10s
    // a fresh draftPick frame with a short clock restarts the countdown in the red
    await page.evaluate(() =>
      (window as unknown as { __emit: (o: unknown) => void }).__emit({
        type: 'draftPick',
        draftId: 'd-1',
        draft: {
          booster: [{ id: 'd9', name: 'Shock', set: 'M19', num: '156' }],
          picks: [],
          timeout: 8,
          boosterNum: 1,
          cardNum: 3,
          setNames: ['Core Set 2019'],
        },
      }),
    )
    await expect(timer).toHaveClass(/urgent/)
    await expect(pos).toContainText('Pack 1 · Pick 3')
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
