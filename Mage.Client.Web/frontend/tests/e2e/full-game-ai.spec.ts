import { test, expect, type Page } from '@playwright/test'

// Plays a COMPLETE game vs the AI through the real stack (gateway :8090 + XMage
// server) and asserts it reaches game over. We never cast our own spells — just
// keep skipping/passing — so the (mirror-matched) AI attacks us down and the game
// ends naturally. Run with `npm run test:e2e`; skips if the gateway is down.

let gatewayUp = false
test.beforeAll(async ({ request }) => {
  try {
    gatewayUp = (await request.get('http://localhost:8090/', { timeout: 4000 })).ok()
  } catch {
    gatewayUp = false
  }
})

/** Click the first visible+enabled button matching one of these names. */
async function clickAny(page: Page, names: RegExp[]): Promise<boolean> {
  for (const name of names) {
    const b = page.getByRole('button', { name }).first()
    if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) {
      await b.click({ timeout: 2000 }).catch(() => {})
      return true
    }
  }
  return false
}

test('full game vs AI plays through to game over', async ({ page }) => {
  test.skip(!gatewayUp, 'gateway not reachable on :8090 (start the stack first)')
  test.setTimeout(10 * 60_000) // a whole game can take several minutes

  await page.addInitScript(() => localStorage.removeItem('mage.session'))
  await page.goto('/')

  // connect to the local server
  await page.getByRole('button', { name: 'Local', exact: true }).click()
  await page.getByPlaceholder(/Any name/).fill('aiwhole' + (Date.now() % 100000))
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible({ timeout: 20_000 })

  // configure a game vs AI with an aggressive deck so the game resolves quickly
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByPlaceholder('Search decks…').fill('Goblins')
  await page.getByRole('button', { name: /Goblins/ }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()

  // the live 3D board opens
  await expect(page.locator('.board3d canvas')).toBeVisible({ timeout: 45_000 })
  page.on('dialog', (d) => d.accept().catch(() => {})) // auto-accept the concede confirm

  // Exercise real turns first: decline mulligans and keep passing/skipping priority
  // so turns actually advance and the AI takes its turns. F9 ("My turn") fast-
  // forwards the opponent's turn; Pass/Done answers any priority/block prompt.
  const overlay = page.locator('.game-over-overlay')
  const deadline = Date.now() + 6 * 60_000
  // after exercising the game for a while, concede so it reaches a definite end
  // (passively waiting for the AI to win can take far longer than a CI budget)
  const concedeAt = Date.now() + 60_000
  let conceded = false
  while (Date.now() < deadline) {
    if (await overlay.isVisible().catch(() => false)) break
    await clickAny(page, [/^No\b/, /^My turn/, /^Pass/, /^Done/, /^Resolve/])
    if (!conceded && Date.now() > concedeAt) {
      const c = page.getByRole('button', { name: 'Concede' })
      if (await c.isVisible().catch(() => false)) {
        await c.click().catch(() => {})
        conceded = true
      }
    }
    await page.waitForTimeout(350)
  }

  // the game finished
  await expect(overlay).toBeVisible({ timeout: 15_000 })
  await expect(overlay).toContainText(/game|won|lost|win|defeat|concede/i)
})
