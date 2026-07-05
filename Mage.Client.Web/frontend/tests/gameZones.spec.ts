import { test, expect, type Page } from '@playwright/test'
import { gotoScreen, gotoCustomGame, SAMPLE, card } from './harness'

/*
 * Legacy-parity zone features on the game board:
 *   • zone browsers (graveyard / exile / command) opened from the player strip,
 *   • the auto-opening target-candidate picker (delve/flashback/tutor picks),
 *   • the "Special" action button in the control dock,
 *   • attachments tucking under their host (via window.__board3d positions),
 *   • the command zone pile + castable commander,
 *   • player counters / designations in the strip,
 *   • the revealed/looked-at overlay + its reopen chip,
 *   • permanent-counter / COPY badges + face-down rendering.
 */

type Rendered = { id: string; x: number; y: number; onScreen: boolean; tapped: boolean; faceDown: boolean }
type Badge = { cardId: string; text: string; onScreen: boolean }
type B3D = { rendered(): Rendered[]; badges(): Badge[]; cardScreenPos(id: string): { id: string; x: number; y: number } | null }

async function waitBoard(page: Page) {
  await expect(page.locator('.board3d canvas')).toBeVisible()
  await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
}
const rendered = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: B3D }).__board3d.rendered()) as Promise<Rendered[]>
const badges = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: B3D }).__board3d.badges()) as Promise<Badge[]>

/** Capture /api/game/respond bodies. */
async function captureResponds(page: Page): Promise<{ kind: string; value?: string }[]> {
  const sent: { kind: string; value?: string }[] = []
  await page.route('**/api/game/respond', (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  return sent
}

test.describe('Zone browsers', () => {
  test('strip zone counts open the graveyard browser; Esc and ✕ close it', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    const seat = page.locator('.pstat', { hasText: 'Computer' })
    // the grave count is a browse button inside the seat chip
    await seat.locator('.pstat-zone-btn', { hasText: 'Grave' }).click()
    const dlg = page.locator('.zone-browser')
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('Computer — graveyard (1)')
    await expect(dlg.locator('.zb-card')).toHaveCount(1)
    await expect(dlg).toContainText('Shock')
    // Esc closes
    await page.keyboard.press('Escape')
    await expect(page.locator('.zone-browser')).toHaveCount(0)
    // ✕ closes too
    await seat.locator('.pstat-zone-btn', { hasText: 'Grave' }).click()
    await expect(page.locator('.zone-browser')).toBeVisible()
    await page.locator('.zb-close').click()
    await expect(page.locator('.zone-browser')).toHaveCount(0)
  })

  test('the strip shows an exile count and it opens the (empty) exile browser', async ({ page }) => {
    await gotoScreen(page, 'game')
    const seat = page.locator('.pstat', { hasText: 'Computer' })
    await expect(seat.locator('.pstat-counts')).toContainText(/Exile 0|E0/)
    await seat.locator('.pstat-zone-btn', { hasText: 'Exile' }).click()
    const dlg = page.locator('.zone-browser')
    await expect(dlg).toContainText('Computer — exile (0)')
    await expect(dlg).toContainText('Empty')
  })

  test('battlefield browses as a group-able grid, for self and opponents', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    // the viewer's own battlefield (Serra Angel, Rancor, 2 Islands = 4)
    const you = page.locator('.pstat', { hasText: 'You' })
    await you.locator('.pstat-zone-btn', { hasText: '▦' }).click()
    const dlg = page.locator('.zone-browser')
    await expect(dlg).toContainText('You — battlefield (4)')
    await expect(dlg.locator('.zb-card')).toHaveCount(4)
    // grouped by type by default → a Creature and a Land section
    await expect(dlg.locator('.zb-section-title', { hasText: /Creature/i })).toBeVisible()
    await expect(dlg.locator('.zb-section-title', { hasText: /Land/i })).toBeVisible()
    // regroup by mana value → still all 4 cards, choice persists
    await dlg.getByLabel('Group cards by').selectOption('mana')
    await expect(dlg.locator('.zb-card')).toHaveCount(4)
    expect(await page.evaluate(() => localStorage.getItem('mage.zoneGroupBy'))).toBe('mana')
    await page.keyboard.press('Escape')
    // an opponent's battlefield is browsable too (public zone)
    const opp = page.locator('.pstat', { hasText: 'Computer' })
    await opp.locator('.pstat-zone-btn', { hasText: '▦' }).click()
    await expect(page.locator('.zone-browser')).toContainText('Computer — battlefield')
  })

  test('a playable card inside the browser responds through the normal path', async ({ page }) => {
    // the viewer's graveyard holds a flashback-castable card (in canPlay)
    const g = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
    const you = g.players.find((p) => p.name === 'You')!
    you.graveyard = [card('gyx', 'Lightning Bolt', ['Instant'], { colors: 'R', manaCost: '{R}' })]
    you.graveyardCount = 1
    g.canPlay = ['gyx']
    await gotoCustomGame(page, g)
    await expect(page.locator('.board3d canvas')).toBeVisible()
    const sent = await captureResponds(page)
    await page.locator('.pstat', { hasText: 'You' }).locator('.pstat-zone-btn', { hasText: 'Grave' }).click()
    const tile = page.locator('.zone-browser .zb-card', { hasText: 'Lightning Bolt' })
    await expect(tile).toHaveClass(/zb-actionable/)
    await tile.locator('.card-tile-art').click()
    await expect.poll(() => sent.find((s) => s.kind === 'uuid')?.value).toBe('gyx')
  })
})

test.describe('Target-candidate picker', () => {
  test('a target prompt with candidates auto-opens the picker; clicking responds uuid', async ({ page }) => {
    await gotoScreen(page, 'gamePick')
    const dlg = page.locator('.zone-browser')
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('Choose a card to exile (delve) — graveyard')
    await expect(dlg.locator('.zb-card')).toHaveCount(3)
    const sent = await captureResponds(page)
    await dlg.locator('.zb-card', { hasText: 'Gurmag Angler' }).locator('.card-tile-art').click()
    await expect.poll(() => sent.find((s) => s.kind === 'uuid')?.value).toBe('gy3')
    // single pick (max 1) → the picker closes after responding
    await expect(page.locator('.zone-browser')).toHaveCount(0)
  })

  test('multi-pick respects min/max across server re-prompts and finishes with Done', async ({ page }) => {
    // Real xmage flow: each pick round-trips (the optimistic prompt clear closes
    // the picker; the server re-prompts with the remaining candidates and flips
    // canCancel on once enough targets are chosen). Simulate that with __push.
    const base = { ...SAMPLE.prompts.gamePick, message: 'Exile two cards (delve)', min: 2, max: 2, canCancel: false }
    await gotoCustomGame(page, SAMPLE.game, base)
    const dlg = page.locator('.zone-browser')
    await expect(dlg).toBeVisible()
    const sent = await captureResponds(page)
    // not enough picked yet → Done is disabled
    await expect(dlg.getByRole('button', { name: 'Done' })).toBeDisabled()
    await dlg.locator('.zb-card', { hasText: 'Shock' }).locator('.card-tile-art').click()
    await expect.poll(() => sent.find((s) => s.kind === 'uuid')?.value).toBe('gy1')
    // the optimistic prompt clear closes the picker until the server re-prompts
    await expect(page.locator('.zone-browser')).toHaveCount(0)
    const rePrompt = (p: unknown) =>
      page.evaluate((pp) => (window as unknown as { __push: (x: unknown) => void }).__push(pp), p)
    await rePrompt({ ...base, candidates: base.candidates.slice(1) })
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.zb-card')).toHaveCount(2)
    await expect(dlg.getByRole('button', { name: 'Done' })).toBeDisabled()
    await dlg.locator('.zb-card', { hasText: 'Thought Scour' }).locator('.card-tile-art').click()
    await expect.poll(() => sent.filter((s) => s.kind === 'uuid').map((s) => s.value)).toEqual(['gy1', 'gy2'])
    // enough targets chosen → the server re-prompts with canCancel=true → Done enabled
    await rePrompt({ ...base, candidates: base.candidates.slice(2), canCancel: true })
    await expect(dlg).toBeVisible()
    const done = dlg.getByRole('button', { name: 'Done' })
    await expect(done).toBeEnabled()
    await done.click()
    await expect(page.locator('.zone-browser')).toHaveCount(0)
    expect(sent.some((s) => s.kind === 'boolean' && s.value === 'false')).toBe(true)
  })
})

test.describe('Special actions', () => {
  test('the Special action (in the ⚡ popover) responds {kind:string, value:special}', async ({ page }) => {
    await gotoScreen(page, 'gameSpecial')
    const sent = await captureResponds(page)
    await page.locator('.cmd-plays-btn').click()
    const btn = page.locator('.cmd-play-item.special')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('Special')
    await btn.click()
    await expect.poll(() => sent.find((s) => s.kind === 'string')?.value).toBe('special')
  })

  test('no Special button when the game has no special actions', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
    await expect(page.locator('.dock-special')).toHaveCount(0)
  })
})

test.describe('Attachments & command zone (3D board)', () => {
  test('an attached aura tucks under its host at the host slot', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    await expect
      .poll(async () => {
        const r = await rendered(page)
        return !!(r.find((c) => c.id === 'b3') && r.find((c) => c.id === 'att1'))
      }, { timeout: 15000 })
      .toBe(true)
    const r = await rendered(page)
    const host = r.find((c) => c.id === 'b3')!
    const att = r.find((c) => c.id === 'att1')!
    // tucked: same column as the host, peeking toward the viewer (larger screen y)
    expect(Math.abs(att.x - host.x)).toBeLessThan(40)
    expect(att.y).toBeGreaterThan(host.y + 2)
  })

  test('the command zone renders as a labelled pile and the commander is playable', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    // exactly one seat (You) has command-zone content
    await expect(page.locator('.c3d-zone', { hasText: 'Cmd' })).toHaveCount(1)
    // the commander's card is rendered (top of the pile) …
    await expect
      .poll(async () => (await rendered(page)).some((c) => c.id === 'cmd1'), { timeout: 15000 })
      .toBe(true)
    // … and castable from the ⚡ plays popover like any other card (canPlay path)
    const sent = await captureResponds(page)
    await page.locator('.cmd-plays-btn').click()
    await page.locator('.cmd-play-item', { hasText: 'Ghalta' }).click()
    await expect.poll(() => sent.find((s) => s.kind === 'uuid')?.value).toBe('cmd1')
  })

  test('permanent counters and COPY render as board badges; face-down is tracked', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    await expect
      .poll(async () => (await badges(page)).map((b) => b.text), { timeout: 15000 })
      .toContain('+1/+1 ×2')
    expect((await badges(page)).some((b) => b.cardId === 'a4' && b.text === 'COPY')).toBe(true)
    // the face-down morph renders (as a card back) and reports faceDown
    const r = await rendered(page)
    expect(r.find((c) => c.id === 'a3')?.faceDown).toBe(true)
  })
})

test.describe('Player counters & designations', () => {
  test('poison / energy counters and the Monarch chip show in the strip', async ({ page }) => {
    await gotoScreen(page, 'game')
    const comp = page.locator('.pstat', { hasText: 'Computer' })
    await expect(comp.locator('.pstat-counter.pc-poison')).toHaveText('☠3')
    await expect(comp.locator('.pstat-desig')).toContainText('Monarch')
    const you = page.locator('.pstat', { hasText: 'You' })
    await expect(you.locator('.pstat-counter.pc-energy')).toHaveText('⚡2')
  })
})

test.describe('Revealed / looked-at overlay', () => {
  test('auto-opens on new content, closes, and reopens from the toolbar chip', async ({ page }) => {
    await gotoScreen(page, 'gameReveal')
    const dlg = page.locator('.zone-browser')
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('Computer reveals (2)')
    await expect(dlg).toContainText('Emrakul, the Aeons Torn')
    // the nameless looked-at card falls back to its set/num face label
    await expect(dlg).toContainText('Scry (1)')
    await expect(dlg).toContainText('M21 7')
    // dismiss → the panel stays closed but the toolbar chip remains
    await page.locator('.zb-close').click()
    await expect(page.locator('.zone-browser')).toHaveCount(0)
    const chip = page.locator('.revealed-chip')
    await expect(chip).toHaveText(/Revealed \(3\)/)
    await chip.click()
    await expect(page.locator('.zone-browser')).toBeVisible()
  })
})
