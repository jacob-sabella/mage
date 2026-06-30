import { test, expect, type Page } from '@playwright/test'
import type { CDPSession } from '@playwright/test'
import { gotoScreen } from './harness'

/*
 * ===========================================================================
 *  GESTURE-COVERAGE SUITE   (opt-in: GESTURE=1 — `npm run test:gesture`)
 * ===========================================================================
 *  REAL on-canvas gesture tests for the react-three-fiber WebGL board. Where
 *  the interaction-coverage suite drives the DOM controls around the board,
 *  this suite drives genuine pointer / touch / wheel events ON the <canvas>
 *  surface and asserts the actual outcome:
 *
 *    • tap-a-card (mouse + touch)  → the faux backend records a play (/respond)
 *    • long-press preview (touch)  → the card action sheet opens; a quick tap doesn't
 *    • pinch-zoom (touch)          → OrbitControls camera distance shrinks
 *    • pan (touch) / rotate (mouse)→ camera target / position moves
 *    • wheel-zoom (mouse)          → camera distance changes
 *    • DOM zoom controls           → custom zoom factor + camera distance change
 *
 *  Card hits are aimed deterministically by projecting a card's world position
 *  to canvas pixels through `window.__board3d` (the readonly debug hook added to
 *  Board3D.tsx — see BoardDebug). Camera effects are read back through the same
 *  hook and asserted as concrete numeric changes, not "no error".
 * ===========================================================================
 */

const GESTURE = !!process.env.GESTURE
const suite = GESTURE ? test.describe : test.describe.skip

// A real mobile/touch context: coarse pointer (isMobile) at a phone-ish width
// (<=760px) so the board boots in `free` mode — the one-finger-pan / two-finger-
// pinch flat-table mode whose gestures this suite exercises.
const TOUCH = { hasTouch: true, isMobile: true, viewport: { width: 720, height: 1000 } } as const

// ---------------------------------------------------------------------------
// hook helpers — everything goes through window.__board3d
// ---------------------------------------------------------------------------
type Cam = { pos: [number, number, number]; target: [number, number, number]; distance: number }
type Pos = { id: string; x: number; y: number }

/** Wait for the board canvas to mount AND the debug hook to be installed. */
async function waitBoard(page: Page) {
  await expect(page.locator('.board3d canvas')).toBeVisible()
  await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, {
    timeout: 15000,
  })
  // let the camera rig settle for a couple of frames
  await page.waitForTimeout(250)
}

const readCam = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: { camera(): Cam } }).__board3d.camera()) as Promise<Cam>

const readZoom = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: { zoom(): number } }).__board3d.zoom())

const readMode = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: { mode(): string } }).__board3d.mode())

const readCards = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: { cards(): Pos[] } }).__board3d.cards()) as Promise<Pos[]>

/** Canvas-relative card position → absolute page pixels (what mouse/touch want). */
async function cardPagePos(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  const box = await page.locator('.board3d canvas').boundingBox()
  if (!box) return null
  const p = await page.evaluate(
    (cid) => (window as unknown as { __board3d: { cardScreenPos(id: string): Pos | null } }).__board3d.cardScreenPos(cid),
    id,
  )
  if (!p) return null
  return { x: box.x + p.x, y: box.y + p.y }
}

/** Poll until at least one of `ids` is visible on the board; returns its page pos. */
async function firstVisibleCardPos(page: Page, ids: string[]): Promise<{ id: string; x: number; y: number }> {
  let found: { id: string; x: number; y: number } | null = null
  await expect
    .poll(
      async () => {
        const cards = await readCards(page)
        const hit = cards.find((c) => ids.includes(c.id))
        if (!hit) return false
        const box = await page.locator('.board3d canvas').boundingBox()
        if (!box) return false
        found = { id: hit.id, x: box.x + hit.x, y: box.y + hit.y }
        return true
      },
      { timeout: 15000 },
    )
    .toBe(true)
  return found!
}

/** A point on the canvas away from any card (the table centre is clear in-game). */
async function clearCanvasPoint(page: Page): Promise<{ x: number; y: number; box: { x: number; y: number; width: number; height: number } }> {
  const box = (await page.locator('.board3d canvas').boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

// ---------------------------------------------------------------------------
// CDP touch dispatch — real touch → real pointer events (native pointer capture,
// so OrbitControls' setPointerCapture works, unlike synthetic PointerEvents).
// ---------------------------------------------------------------------------
async function newTouch(page: Page) {
  return page.context().newCDPSession(page)
}
function touch(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) {
  return session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y })) })
}

// ===========================================================================
//  1. TAP A CARD
// ===========================================================================
suite('Gesture · tap a card', () => {
  test('mouse: clicking a playable card on the canvas plays it (/respond uuid)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    let played: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') played = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    // canPlay in the sample game = h1 (Lightning Bolt, hand), h3 (Mulldrifter), b3 (Serra Angel, battlefield)
    const card = await firstVisibleCardPos(page, ['h1', 'h3', 'b3'])
    await page.mouse.click(card.x, card.y)
    await expect.poll(() => played, { timeout: 8000 }).toBe(card.id)
  })
})

suite('Gesture · tap a card · touch', () => {
  test.use(TOUCH)
  test('touch: tapping a playable card on the canvas plays it (/respond uuid)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    let played: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') played = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    const card = await firstVisibleCardPos(page, ['h1', 'h3', 'b3'])
    await page.touchscreen.tap(card.x, card.y)
    await expect.poll(() => played, { timeout: 8000 }).toBe(card.id)
  })
})

suite('Gesture · tap a card on a dense board · touch', () => {
  test.use(TOUCH)
  test('touch: tapping a playable card on a maxed 4-player board plays it', async ({ page }) => {
    await gotoScreen(page, 'game4p')
    await waitBoard(page)
    let played: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') played = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    // the hand is now a fixed DOM fan at the bottom; a playable card in it stays
    // tappable even on a packed 4-player board (h1 Lightning Bolt / h3 Mulldrifter)
    await page.locator('.hand-card.playable').first().tap()
    await expect.poll(() => played, { timeout: 8000 }).toBe('h1')
  })
})

// ===========================================================================
//  2. LONG-PRESS PREVIEW  (touch)
// ===========================================================================
suite('Gesture · long-press preview · touch', () => {
  test.use(TOUCH)
  test('a ~600ms hold on a card opens the action sheet; a quick tap does not', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    // suppress the play that a quick tap would otherwise send
    await page.route('**/api/game/respond', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    )
    const card = await firstVisibleCardPos(page, ['h1', 'h3', 'b3', 'b1', 'b2'])
    // drive BOTH gestures through the same CDP touch channel — interleaving
    // page.touchscreen with a separate CDP session corrupts the touch state.
    const t = await newTouch(page)

    // quick tap first: must NOT open the action sheet (preview never hijacks a tap)
    await touch(t, 'touchStart', [{ x: card.x, y: card.y }])
    await touch(t, 'touchEnd', [])
    await page.waitForTimeout(200)
    await expect(page.locator('.card-action-sheet')).toHaveCount(0)

    // now hold ~600ms (> the 450ms long-press threshold) → action sheet opens
    await touch(t, 'touchStart', [{ x: card.x, y: card.y }])
    await page.waitForTimeout(600)
    await expect(page.locator('.card-action-sheet')).toBeVisible()
    await touch(t, 'touchEnd', [])
    // the long-press consumed the gesture: releasing does not also play/close-then-play
    await expect(page.locator('.card-action-sheet')).toBeVisible()
  })
})

// ===========================================================================
//  3. PINCH-ZOOM  (touch, free mode)
// ===========================================================================
suite('Gesture · pinch-zoom · touch', () => {
  test.use(TOUCH)
  test('two fingers spreading apart dollies the camera closer (distance shrinks)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    expect(await readMode(page)).toBe('free') // mobile boots into the pan/pinch flat board
    const before = (await readCam(page)).distance
    const { x: cx, y: cy } = await clearCanvasPoint(page)
    const t = await newTouch(page)

    // start with two fingers close together, then spread them apart = pinch-out = dolly in
    let spread = 30
    await touch(t, 'touchStart', [
      { x: cx - spread, y: cy },
      { x: cx + spread, y: cy },
    ])
    for (let i = 0; i < 8; i++) {
      spread += 22
      await touch(t, 'touchMove', [
        { x: cx - spread, y: cy },
        { x: cx + spread, y: cy },
      ])
      await page.waitForTimeout(16)
    }
    await touch(t, 'touchEnd', [])

    await expect
      .poll(async () => (await readCam(page)).distance < before - 0.5, { timeout: 6000 })
      .toBe(true)
  })
})

// ===========================================================================
//  4. PAN (touch) + ROTATE (mouse drag)
// ===========================================================================
suite('Gesture · pan · touch', () => {
  test.use(TOUCH)
  test('one-finger drag pans the camera (orbit target moves)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    expect(await readMode(page)).toBe('free')
    const before = (await readCam(page)).target
    const { x: cx, y: cy } = await clearCanvasPoint(page)
    const t = await newTouch(page)

    await touch(t, 'touchStart', [{ x: cx, y: cy }])
    for (let i = 1; i <= 10; i++) {
      await touch(t, 'touchMove', [{ x: cx - i * 14, y: cy - i * 8 }])
      await page.waitForTimeout(16)
    }
    await touch(t, 'touchEnd', [])

    await expect
      .poll(
        async () => {
          const a = (await readCam(page)).target
          return Math.hypot(a[0] - before[0], a[1] - before[1], a[2] - before[2])
        },
        { timeout: 6000 },
      )
      .toBeGreaterThan(0.3)
  })
})

suite('Gesture · rotate · mouse drag (desktop free)', () => {
  test('dragging in Free mode orbits the camera (position moves, distance ~constant)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    // desktop boots in 3d; switch to Free so OrbitControls (rotate) owns the camera
    await page.locator('.view-fab').click()
    await page.getByRole('button', { name: 'Free' }).click()
    await page.locator('.view-fab').click() // close the menu
    await expect.poll(() => readMode(page)).toBe('free')

    const before = await readCam(page)
    const { x: cx, y: cy } = await clearCanvasPoint(page)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(cx + i * 16, cy + i * 4)
      await page.waitForTimeout(12)
    }
    await page.mouse.up()

    await expect
      .poll(
        async () => {
          const a = await readCam(page)
          const moved = Math.hypot(a.pos[0] - before.pos[0], a.pos[1] - before.pos[1], a.pos[2] - before.pos[2])
          return moved
        },
        { timeout: 6000 },
      )
      .toBeGreaterThan(0.5)
    // a pure rotation keeps the orbit distance roughly the same
    const after = await readCam(page)
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(before.distance * 0.25 + 0.5)
  })
})

// ===========================================================================
//  5. WHEEL ZOOM  (mouse, free mode)
// ===========================================================================
suite('Gesture · wheel zoom (desktop free)', () => {
  test('scrolling the wheel over the canvas changes the camera distance', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    await page.locator('.view-fab').click()
    await page.getByRole('button', { name: 'Free' }).click()
    await page.locator('.view-fab').click()
    await expect.poll(() => readMode(page)).toBe('free')

    const before = (await readCam(page)).distance
    const { x: cx, y: cy } = await clearCanvasPoint(page)
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -120) // scroll up = dolly in
      await page.waitForTimeout(20)
    }
    await expect
      .poll(async () => Math.abs((await readCam(page)).distance - before), { timeout: 6000 })
      .toBeGreaterThan(0.5)
  })
})

// ===========================================================================
//  6. DOM ZOOM CONTROLS  (the −/% /+ strip — drives the custom zoom factor)
// ===========================================================================
suite('Gesture · DOM zoom controls', () => {
  test('mouse: +/- and reset change the custom zoom factor AND the camera distance', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    // the manual 3D camera is the one whose distance tracks the zoom factor; the
    // desktop default is now the cinematic Auto cam, so select 3D first
    await page.locator('.view-fab').click()
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await page.locator('.view-fab').click()
    await expect.poll(() => readMode(page)).toBe('3d')
    expect(await readZoom(page)).toBeCloseTo(0.75, 2)
    const dist0 = (await readCam(page)).distance

    // zoom IN → factor rises, camera distance drops (applyZoom scales 1/zoom)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(() => readZoom(page)).toBeCloseTo(1.0, 2)
    await expect.poll(async () => (await readCam(page)).distance < dist0 - 0.5, { timeout: 6000 }).toBe(true)

    // reset (the % is a real button) → back to default factor + distance
    await page.getByRole('button', { name: 'Reset zoom' }).click()
    await expect.poll(() => readZoom(page)).toBeCloseTo(0.75, 2)
    await expect.poll(async () => Math.abs((await readCam(page)).distance - dist0) < 0.5, { timeout: 6000 }).toBe(true)
  })

  test('keyboard: Enter on the focused Zoom-in button zooms in', async ({ page }) => {
    await gotoScreen(page, 'game')
    await waitBoard(page)
    const zin = page.getByRole('button', { name: 'Zoom in' })
    await zin.focus()
    await expect(zin).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => readZoom(page)).toBeCloseTo(1.0, 2)
  })

  test('touch: tapping +/- changes the zoom factor', async ({ browser }) => {
    const ctx = await browser.newContext(TOUCH)
    const page = await ctx.newPage()
    await gotoScreen(page, 'game')
    await waitBoard(page)
    // mobile boots in free mode (no zoom strip) — switch to 3D first
    await page.locator('.view-fab').tap()
    await page.getByRole('button', { name: '3D', exact: true }).tap()
    await page.locator('.view-fab').tap()
    await expect.poll(() => readMode(page)).toBe('3d')
    const z0 = await readZoom(page)
    await page.getByRole('button', { name: 'Zoom in' }).tap()
    await expect.poll(() => readZoom(page)).toBeGreaterThan(z0)
    await ctx.close()
  })
})

// a single always-present marker so the file is never "empty" when skipped
test('gesture-coverage suite is opt-in (GESTURE=1)', () => {
  test.skip(!GESTURE, 'run with GESTURE=1 (npm run test:gesture)')
  expect(GESTURE).toBe(true)
})
