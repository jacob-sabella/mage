import { test, expect } from '@playwright/test'

// End-to-end through the REAL stack (gateway on :8090 + XMage server). Unlike the
// faux-backend suite, nothing is stubbed: this connects, creates a real game vs
// AI, and asserts the live board + real card indicators render. Run with
// `npm run test:e2e` while the gateway/server are up; it skips if unreachable.

let gatewayUp = false
test.beforeAll(async ({ request }) => {
  try {
    gatewayUp = (await request.get('http://localhost:8090/', { timeout: 4000 })).ok()
  } catch {
    gatewayUp = false
  }
})

test('real game vs AI: connect → board → live card indicators', async ({ page }) => {
  test.skip(!gatewayUp, 'gateway not reachable on :8090 (start it with scripts/run-gateway.sh)')
  test.setTimeout(90_000)

  await page.addInitScript(() => localStorage.removeItem('mage.session')) // force fresh login
  await page.goto('/')

  // connect to the local server
  await page.getByRole('button', { name: 'Local', exact: true }).click()
  await page.getByPlaceholder(/Any name/).fill('e2e' + (Date.now() % 100000))
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible({ timeout: 20_000 })

  // start a game vs AI with a creature-heavy deck so P/T badges appear
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByPlaceholder('Search decks…').fill('Goblins')
  await page.getByRole('button', { name: /Goblins/ }).first().click()
  await page.getByRole('button', { name: 'Start game' }).click()

  // the live 3D board opens
  await expect(page.locator('.board3d canvas')).toBeVisible({ timeout: 30_000 })

  // Real game flow is nondeterministic (who's on the play, when the mulligan
  // arrives). Keep answering the mulligan (keep = No) until the Goblins hand is
  // dealt and its real card indicators render.
  await expect(async () => {
    const no = page.getByRole('button', { name: 'No' })
    if (await no.isVisible().catch(() => false)) {
      await no.click().catch(() => {})
    }
    expect(await page.locator('.c3d-pip').count()).toBeGreaterThan(0) // mana-cost pips
    // a creature P/T badge (now an in-canvas sprite, read via the debug hook)
    const pts = await page.evaluate(
      () => (window as unknown as { __board3d?: { badges(): { text: string }[] } }).__board3d?.badges() ?? [],
    )
    expect(pts.some((b) => /^\d+\/\d+$/.test(b.text))).toBe(true)
  }).toPass({ timeout: 60_000, intervals: [1000] })

  // the interactive game UI is live (skip bar + log) regardless of whose priority
  await expect(page.getByRole('button', { name: /My turn/ })).toBeVisible()
  await expect(page.locator('.game-log')).toBeVisible({ timeout: 30_000 })
})
