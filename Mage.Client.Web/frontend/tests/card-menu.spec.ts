import { test, expect, type Page } from '@playwright/test'
import { gotoScreen } from './harness'

/*
 * ===========================================================================
 *  CARD MENU SUITE
 * ===========================================================================
 *  The contextual card menu (right-click / long-press) and the things it drives:
 *    • land stack → "tap N from the stack" feeds N sequential /respond uuid's
 *    • "Undo tap" → /respond action UNDO
 *    • the xmage ability picker anchored to the just-activated card
 *    • bottom-bar fallback when no card was clicked (DOM-only, always runs)
 *
 *  The canvas-interaction tests need real mouse events on the WebGL board, so —
 *  like gesture-coverage — they're opt-in behind GESTURE=1 (`npm run test:gesture`).
 *  Card hits are aimed by projecting a card id to canvas pixels via window.__board3d.
 * ===========================================================================
 */

const GESTURE = !!process.env.GESTURE
const canvasSuite = GESTURE ? test.describe : test.describe.skip

type Pos = { id: string; x: number; y: number }

async function waitBoard(page: Page) {
  await expect(page.locator('.board3d canvas')).toBeVisible()
  await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
  await page.waitForTimeout(250)
}

/** Switch to the static 2D top-down camera so cards stop drifting (the default
 *  Auto cinematic cam keeps easing, which can move a card between the pixel read
 *  and the click). Makes the on-canvas hits deterministic. */
async function freezeCamera(page: Page) {
  await page.locator('.view-fab').click()
  await page.getByRole('button', { name: '2D', exact: true }).click()
  await page.locator('.view-fab').click()
  await page.waitForFunction(
    () => (window as unknown as { __board3d?: { mode(): string } }).__board3d?.mode() === '2d',
    null,
    { timeout: 8000 },
  )
  await page.waitForTimeout(300)
}

/** Canvas-relative card position → absolute page pixels. Reads fresh each call so
 *  the slowly-drifting auto camera doesn't stale the coordinate. */
async function cardPagePos(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.board3d canvas').boundingBox())!
  const p = (await page.evaluate(
    (cid) => (window as unknown as { __board3d: { cardScreenPos(id: string): Pos | null } }).__board3d.cardScreenPos(cid),
    id,
  )) as Pos | null
  if (!p) throw new Error(`card ${id} not on screen`)
  return { x: box.x + p.x, y: box.y + p.y }
}

const ABILITY_PROMPT = {
  kind: 'choice',
  message: 'Choose an ability to activate',
  canCancel: true,
  min: 0,
  max: 0,
  choices: [
    { key: 'ab-mana', label: 'Tap: Add {G}' },
    { key: 'ab-sac', label: 'Sacrifice: Draw a card' },
  ],
  choiceKind: 'uuid',
  targets: [],
}

// ---------------------------------------------------------------------------
//  DOM-only — always runs
// ---------------------------------------------------------------------------
test.describe('card menu · bottom-bar fallback', () => {
  test('an ability picker with no preceding card click stays in the bottom bar', async ({ page }) => {
    await gotoScreen(page, 'ability')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    await page.getByRole('button', { name: 'Pass' }).waitFor()

    // push the ability picker without any card having been activated first
    await page.evaluate((p) => (window as unknown as { __push: (x: unknown) => void }).__push(p), ABILITY_PROMPT)

    // it lands in the bottom action bar, not in a card-anchored menu
    await expect(page.locator('.choice-list')).toContainText('Add {G}')
    await expect(page.locator('.card-action-sheet')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
//  Canvas interaction — GESTURE=1
// ---------------------------------------------------------------------------
canvasSuite('card menu · land stack · canvas', () => {
  test('right-click a stack → "Tap 3" feeds 3 distinct untapped lands in sequence', async ({ page }) => {
    await gotoScreen(page, 'landstack')
    await waitBoard(page)
    await freezeCamera(page)

    // re-push priority after each respond so the tap queue can drain one per round
    const tapped: string[] = []
    await page.route('**/api/game/respond', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') tapped.push(b.value)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      await page.evaluate(() => (window as unknown as { __push: (x?: unknown) => void }).__push()).catch(() => {})
    })

    // open the menu on the collapsed Forest stack (representative = first member fl1)
    const pos = await cardPagePos(page, 'fl1')
    await page.mouse.click(pos.x, pos.y, { button: 'right' })
    const sheet = page.locator('.card-action-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('3 untapped')

    // step the count up to 3 and tap
    await sheet.getByRole('button', { name: 'More' }).click()
    await sheet.getByRole('button', { name: 'More' }).click()
    await sheet.getByRole('button', { name: /^Tap 3/ }).click()

    // exactly the three untapped lands, each once, never the tapped fl4/fl5
    await expect.poll(() => tapped.length, { timeout: 8000 }).toBe(3)
    expect([...tapped].sort()).toEqual(['fl1', 'fl2', 'fl3'])
  })

  test('"Undo tap" sends /respond action UNDO', async ({ page }) => {
    await gotoScreen(page, 'landstack')
    await waitBoard(page)
    await freezeCamera(page)
    let action: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'action') action = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    const pos = await cardPagePos(page, 'fl1')
    await page.mouse.click(pos.x, pos.y, { button: 'right' })
    const sheet = page.locator('.card-action-sheet')
    await expect(sheet).toBeVisible()
    // fl4/fl5 are tapped, so the undo control is offered
    await sheet.getByRole('button', { name: 'Undo tap' }).click()
    await expect.poll(() => action, { timeout: 8000 }).toBe('UNDO')
  })
})

canvasSuite('card menu · ability picker · canvas', () => {
  test('clicking a permanent then receiving an ability picker anchors the menu to it', async ({ page }) => {
    await gotoScreen(page, 'ability')
    await waitBoard(page)
    await freezeCamera(page)
    await page.route('**/api/game/respond', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    )

    // activate Serra Angel (b3, a playable battlefield card), then the server
    // answers with an ability picker — the menu should open anchored to that card
    const pos = await cardPagePos(page, 'b3')
    await page.mouse.click(pos.x, pos.y)
    await page.evaluate((p) => (window as unknown as { __push: (x: unknown) => void }).__push(p), ABILITY_PROMPT)

    const sheet = page.locator('.card-action-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Serra Angel')
    await expect(sheet.locator('.card-action-abilities')).toContainText('Add {G}')
    // and it's NOT duplicated in the bottom bar
    await expect(page.locator('.choice-list')).toHaveCount(0)
  })
})
