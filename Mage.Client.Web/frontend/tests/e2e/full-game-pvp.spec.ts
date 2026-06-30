import { test, expect, type Page } from '@playwright/test'

// Plays a COMPLETE player-vs-player game through the real stack: two independent
// browser sessions, one opens a joinable table, the other joins, the match starts
// (the gateway auto-starts once both humans are seated) and the game runs to a
// conclusion on BOTH clients. Run with `npm run test:e2e`; skips if the gateway
// is down. The host's table name embeds the host name so we never join a stale
// table left by a previous run.

let gatewayUp = false
test.beforeAll(async ({ request }) => {
  try {
    gatewayUp = (await request.get('http://localhost:8090/', { timeout: 4000 })).ok()
  } catch {
    gatewayUp = false
  }
})

async function connect(page: Page, name: string) {
  await page.addInitScript(() => localStorage.removeItem('mage.session'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Local', exact: true }).click()
  await page.getByPlaceholder(/Any name/).fill(name)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible({ timeout: 20_000 })
}

async function pickGoblins(page: Page) {
  await page.getByPlaceholder('Search decks…').fill('Goblins')
  await page.getByRole('button', { name: /Goblins/ }).first().click()
}

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

test('full PvP game: two humans create + join a table and play to game over', async ({ browser }) => {
  test.skip(!gatewayUp, 'gateway not reachable on :8090 (start the stack first)')
  test.setTimeout(8 * 60_000)

  const host = 'host' + (Date.now() % 100000)
  const guest = 'guest' + ((Date.now() + 31) % 100000)
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  try {
    await connect(a, host)
    await connect(b, guest)

    // A configures a table with one open human seat (0 AI) and opens it
    await a.getByRole('button', { name: 'New game', exact: true }).click()
    await a.getByRole('button', { name: 'Fewer AI opponents' }).click() // 1 -> 0
    await a.getByRole('button', { name: 'More Open seats (humans)' }).click() // 0 -> 1 open
    await pickGoblins(a)
    await a.getByRole('button', { name: 'Create table' }).click()
    await expect(a.locator('.waiting-room')).toBeVisible({ timeout: 15_000 })

    // B locates A's specific table (by host name) and joins it
    const joinHostTable = async () => {
      await b.getByRole('button', { name: 'Refresh' }).click()
      const row = b.locator('tr', { hasText: `${host}'s game` })
      const join = row.getByRole('button', { name: 'Join' })
      await expect(join).toBeVisible({ timeout: 3000 })
      await join.click()
    }
    await expect(joinHostTable).toPass({ timeout: 40_000 })
    await pickGoblins(b) // the join deck picker joins on pick

    // once both seats are filled the owner starts the match → both boards open
    const startBtn = a.getByRole('button', { name: 'Start match' })
    await expect(startBtn).toBeEnabled({ timeout: 40_000 })
    await startBtn.click()
    await expect(a.locator('.board3d canvas')).toBeVisible({ timeout: 60_000 })
    await expect(b.locator('.board3d canvas')).toBeVisible({ timeout: 60_000 })

    // drive both sides; if neither dies fast enough, the guest concedes so the
    // game still reaches a definite conclusion on both clients
    const overA = a.locator('.game-over-overlay')
    const overB = b.locator('.game-over-overlay')
    const deadline = Date.now() + 6 * 60_000
    const concedeAt = Date.now() + 75_000
    let conceded = false
    while (Date.now() < deadline) {
      if ((await overA.isVisible().catch(() => false)) || (await overB.isVisible().catch(() => false))) break
      await clickAny(a, [/^No\b/, /^My turn/, /^Pass/, /^Done/])
      await clickAny(b, [/^No\b/, /^My turn/, /^Pass/, /^Done/])
      if (!conceded && Date.now() > concedeAt) {
        const c = b.getByRole('button', { name: 'Concede' })
        if (await c.isVisible().catch(() => false)) {
          await c.click().catch(() => {})
          await b.locator('.confirm-overlay').getByRole('button', { name: 'Concede' }).click().catch(() => {})
          conceded = true
        }
      }
      await a.waitForTimeout(300)
    }

    // the game ended for BOTH players
    await expect(overA).toBeVisible({ timeout: 20_000 })
    await expect(overB).toBeVisible({ timeout: 20_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('host can cancel an open PvP table before anyone joins', async ({ page }) => {
  test.skip(!gatewayUp, 'gateway not reachable on :8090 (start the stack first)')
  test.setTimeout(60_000)
  await connect(page, 'cancel' + (Date.now() % 100000))
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Fewer AI opponents' }).click() // 1 -> 0
  await page.getByRole('button', { name: 'More Open seats (humans)' }).click() // 0 -> 1 open
  await pickGoblins(page)
  await page.getByRole('button', { name: 'Create table' }).click()
  await expect(page.locator('.waiting-room')).toBeVisible({ timeout: 15_000 })
  // cancel the open table → the waiting room closes
  await page.getByRole('button', { name: 'Cancel table' }).click()
  await expect(page.locator('.waiting-room')).toBeHidden({ timeout: 10_000 })
})
