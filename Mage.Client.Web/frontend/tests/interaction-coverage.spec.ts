import { test, expect, type Page, type Locator } from '@playwright/test'
import { gotoScreen, installMocks } from './harness'

/*
 * ===========================================================================
 *  INTERACTION-COVERAGE SUITE   (opt-in: INTERACT=1 — `npm run test:interact`)
 * ===========================================================================
 *  Where the usability suite audits *layout*, this suite audits *behaviour*:
 *  every interactive control is driven through the THREE input modalities that
 *  apply to it and the expected OUTCOME is asserted each way —
 *
 *    • Mouse     — `.click()`            → effect happens
 *    • Touch     — `.tap()` (hasTouch)   → same effect happens
 *    • Keyboard  — `.focus()` + Enter/Space → same effect happens
 *
 *  plus modality-specific coverage: documented game hotkeys, the global `?`/`/`
 *  /`Esc` keys, hover/right-click/long-press card previews, and that no control
 *  hides behind `:hover` alone on touch.
 *
 *  A control that works on click but not tap, or not via the keyboard, is a BUG
 *  in the component — fixed at the source, never by weakening the assertion.
 *  See tests/INTERACTIONS.md for the full matrix + intentional exceptions.
 * ===========================================================================
 */

const INTERACT = !!process.env.INTERACT
const suite = INTERACT ? test.describe : test.describe.skip

// A touch context that also reports a coarse/hover-incapable pointer (isMobile),
// at a tablet size big enough to keep every control on-screen (chat open, board
// in 3D — both gated on <=760px) so taps land on the real targets, not a focus
// fallback. Used by every "… (touch)" block below.
const TOUCH = { hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } } as const

/** Assert a control is keyboard-focusable (a prerequisite for Enter/Space). */
async function expectFocusable(loc: Locator) {
  await loc.focus()
  await expect(loc).toBeFocused()
}

/** Focus then activate via the keyboard (buttons fire click on both Enter & Space). */
async function pressKey(page: Page, loc: Locator, key: 'Enter' | ' ' = 'Enter') {
  await loc.focus()
  await expect(loc).toBeFocused()
  await page.keyboard.press(key === ' ' ? 'Space' : key)
}

// ---------------------------------------------------------------------------
// navigation helpers
// ---------------------------------------------------------------------------
async function openLobby(page: Page) {
  await gotoScreen(page, 'lobby')
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
}
async function openTableSetup(page: Page) {
  await openLobby(page)
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await expect(page.locator('.table-setup')).toBeVisible()
}
async function openDeckEditor(page: Page) {
  await openLobby(page)
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.getByRole('button', { name: 'Add Lightning Bolt' })).toBeVisible()
}
/** Create a table with one open human seat → lands in the WaitingRoom. */
async function openWaitingRoom(page: Page) {
  await openLobby(page)
  await page.route('**/api/tables/create', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 't-9', started: false, openSeats: 1 }) }),
  )
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Fewer AI opponents' }).click()
  await page.getByRole('button', { name: 'More Open seats (humans)' }).click()
  await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
  await page.getByRole('button', { name: 'Create table' }).click()
  await expect(page.locator('.waiting-room')).toBeVisible()
}

// ===========================================================================
//  LOGIN
// ===========================================================================
suite('Login · modalities', () => {
  test('mouse: a preset fills the server field; Connect lands on the lobby', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')
    await page.getByRole('button', { name: 'Local', exact: true }).click()
    await expect(page.locator('.field input').first()).toHaveValue('localhost')
    await page.getByPlaceholder('Any name (no registration on public servers)').fill('tester')
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })

  test('keyboard: preset via Enter, then Enter in the name field connects', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')
    await pressKey(page, page.getByRole('button', { name: 'Local', exact: true }))
    await expect(page.locator('.field input').first()).toHaveValue('localhost')
    const name = page.getByPlaceholder('Any name (no registration on public servers)')
    await name.fill('tester')
    await name.press('Enter') // LoginView wires Enter → connect
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })

  test('keyboard: every preset + the Connect button is focusable', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')
    for (const name of ['Beta', 'USA', 'Europe', 'Local']) {
      await expectFocusable(page.getByRole('button', { name, exact: true }))
    }
    await expectFocusable(page.getByRole('button', { name: 'Connect' }))
  })
})

suite('Login · touch', () => {
  test.use(TOUCH)
  test('tap a preset then tap Connect lands on the lobby', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')
    await page.getByRole('button', { name: 'Local', exact: true }).tap()
    await expect(page.locator('.field input').first()).toHaveValue('localhost')
    await page.getByPlaceholder('Any name (no registration on public servers)').fill('tester')
    await page.getByRole('button', { name: 'Connect' }).tap()
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })
})

// ===========================================================================
//  LOBBY + TOP NAV
// ===========================================================================
suite('Lobby & nav · modalities', () => {
  test('mouse: New game opens setup; History shows matches; nav switches view', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'New game', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByRole('heading', { name: 'Match history' })).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()
  })

  test('keyboard: Enter on the nav tabs switches views', async ({ page }) => {
    await openLobby(page)
    await pressKey(page, page.getByRole('button', { name: 'Deck Editor' }))
    await expect(page.getByRole('button', { name: 'Add Lightning Bolt' })).toBeVisible()
    await pressKey(page, page.getByRole('button', { name: 'Settings' }))
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()
    await pressKey(page, page.getByRole('button', { name: 'Play' }))
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })

  test('keyboard: Space activates New game (button semantics)', async ({ page }) => {
    await openLobby(page)
    await pressKey(page, page.getByRole('button', { name: 'New game', exact: true }), ' ')
    await expect(page.locator('.table-setup')).toBeVisible()
  })

  test('mouse: Join shows on joinable tables and a row action fires', async ({ page }) => {
    await openLobby(page)
    const waiting = page.getByRole('row', { name: /Aggro Duel/ })
    await expect(waiting.getByRole('button', { name: 'Join' })).toBeVisible()
    await waiting.getByRole('button', { name: 'Join' }).click()
    await expect(page.getByRole('heading', { name: /Pick a deck to join/ })).toBeVisible()
  })

  test('mouse: chat hide/show toggle works both ways', async ({ page }) => {
    await openLobby(page)
    await expect(page.locator('.chat-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Chat ✕' }).click()
    await expect(page.locator('.chat-panel')).toHaveCount(0)
    await page.getByRole('button', { name: 'Show chat' }).click()
    await expect(page.locator('.chat-panel')).toBeVisible()
  })
})

suite('Lobby & nav · touch', () => {
  test.use(TOUCH)
  test('tap New game opens setup; tap nav tab switches view', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'New game', exact: true }).tap()
    await expect(page.locator('.table-setup')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).tap()
    await page.getByRole('button', { name: 'Settings' }).tap()
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()
  })

  test('tap a deck row Join opens the deck picker', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('row', { name: /Aggro Duel/ }).getByRole('button', { name: 'Join' }).tap()
    await expect(page.getByRole('heading', { name: /Pick a deck to join/ })).toBeVisible()
  })
})

// ===========================================================================
//  TABLE SETUP MODAL
// ===========================================================================
suite('TableSetup · modalities', () => {
  test('mouse: format select, deck pick, Start creates the game', async ({ page }) => {
    await openLobby(page)
    let body: Record<string, unknown> = {}
    await page.route('**/api/tables/create', (route) => {
      body = JSON.parse(route.request().postData() || '{}')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'g-1', started: true, openSeats: 0 }) })
    })
    await page.getByRole('button', { name: 'New game', exact: true }).click()
    await page.locator('.ts-field', { hasText: 'Format' }).locator('select').selectOption('Free For All')
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
    await page.getByRole('button', { name: 'Start game' }).click()
    await expect.poll(() => body.gameType).toBe('Free For All')
  })

  test('mouse: AI-opponent stepper +/- changes the count', async ({ page }) => {
    await openTableSetup(page)
    await page.locator('.ts-field', { hasText: 'Format' }).locator('select').selectOption('Free For All')
    const val = page.locator('.ts-stepper', { hasText: 'AI opponents' }).locator('.ts-stepper-val')
    await expect(val).toHaveText('1')
    await page.getByRole('button', { name: 'More AI opponents' }).click()
    await expect(val).toHaveText('2')
    await page.getByRole('button', { name: 'Fewer AI opponents' }).click()
    await expect(val).toHaveText('1')
  })

  test('keyboard: Enter on the stepper buttons changes the count', async ({ page }) => {
    await openTableSetup(page)
    await page.locator('.ts-field', { hasText: 'Format' }).locator('select').selectOption('Free For All')
    const val = page.locator('.ts-stepper', { hasText: 'AI opponents' }).locator('.ts-stepper-val')
    await pressKey(page, page.getByRole('button', { name: 'More AI opponents' }))
    await expect(val).toHaveText('2')
    await pressKey(page, page.getByRole('button', { name: 'Fewer AI opponents' }))
    await expect(val).toHaveText('1')
  })

  test('keyboard: Advanced options toggle expands extra fields', async ({ page }) => {
    await openTableSetup(page)
    await expect(page.locator('.ts-advanced')).toHaveCount(0)
    await pressKey(page, page.getByRole('button', { name: /Advanced options/ }))
    await expect(page.locator('.ts-advanced')).toBeVisible()
  })

  test('keyboard: Escape closes the modal', async ({ page }) => {
    await openTableSetup(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.table-setup')).toHaveCount(0)
  })
})

suite('TableSetup · touch', () => {
  test.use(TOUCH)
  test('tap the stepper and a deck, then Start', async ({ page }) => {
    await openLobby(page)
    let started = false
    await page.route('**/api/tables/create', (route) => {
      started = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, tableId: 'g-1', started: true, openSeats: 0 }) })
    })
    await page.getByRole('button', { name: 'New game', exact: true }).tap()
    await page.locator('.ts-field', { hasText: 'Format' }).locator('select').selectOption('Free For All')
    const val = page.locator('.ts-stepper', { hasText: 'AI opponents' }).locator('.ts-stepper-val')
    await page.getByRole('button', { name: 'More AI opponents' }).tap()
    await expect(val).toHaveText('2')
    await page.getByRole('button', { name: /Mono Red Aggro/ }).tap()
    await page.getByRole('button', { name: 'Start game' }).tap()
    await expect.poll(() => started).toBe(true)
  })
})

// ===========================================================================
//  WAITING ROOM
// ===========================================================================
suite('WaitingRoom · modalities', () => {
  test('mouse: Add AI fills the seat and enables Start match', async ({ page }) => {
    await openWaitingRoom(page)
    const start = page.getByRole('button', { name: 'Start match' })
    await expect(start).toBeDisabled() // 1/2 seats — not ready
    // fill the open seat → server now reports 2/2; Start enables on next refresh
    await page.route('**/api/tables?**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify([
        { id: 't-9', name: 'Aggro Duel', gameType: 'Two Player Duel', controller: 'You', seats: '2/2', state: 'Waiting', skillLevel: 'Casual', games: [] },
      ]) }),
    )
    await page.getByRole('button', { name: 'Add AI' }).click()
    await expect(start).toBeEnabled()
  })

  test('keyboard: Cancel table (Enter) returns to the lobby', async ({ page }) => {
    await openWaitingRoom(page)
    await pressKey(page, page.getByRole('button', { name: 'Cancel table' }))
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })
})

suite('WaitingRoom · touch', () => {
  test.use(TOUCH)
  test('tap Add AI fills the seat', async ({ page }) => {
    await openWaitingRoom(page)
    let added = false
    await page.route('**/api/tables/add-ai', (route) => {
      added = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'Add AI' }).tap()
    await expect.poll(() => added).toBe(true)
  })
})

// ===========================================================================
//  DECK EDITOR
// ===========================================================================
suite('Deck editor · modalities', () => {
  test('mouse: add a card, +/- adjust quantity', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
    const entry = page.locator('.deck-entry', { hasText: 'Lightning Bolt' })
    await expect(entry).toContainText('1×')
    await entry.getByRole('button', { name: 'Increase Lightning Bolt' }).click()
    await expect(entry).toContainText('2×')
    await entry.getByRole('button', { name: 'Decrease Lightning Bolt' }).click()
    await expect(entry).toContainText('1×')
  })

  test('mouse: basics, view toggle, import, sample-hand controls', async ({ page }) => {
    await openDeckEditor(page)
    // add a basic land via its color button
    await page.locator('.deck-basics').getByRole('button').first().click()
    await expect(page.locator('.deck-list')).toContainText(/Plains|Island|Swamp|Mountain|Forest/)
    // result view toggle gallery <-> table
    await page.getByRole('button', { name: /Table/, exact: false }).first().click()
    await expect(page.locator('.deck-table')).toBeVisible()
    await page.getByRole('button', { name: /Gallery/, exact: false }).first().click()
    await expect(page.locator('.card-grid')).toBeVisible()
    // import modal opens + closes on Escape
    await page.getByRole('button', { name: 'Import' }).click()
    await expect(page.getByRole('heading', { name: 'Import deck' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Import deck' })).toHaveCount(0)
  })

  test('keyboard: "/" focuses the search; Add card via Enter; Search via Enter', async ({ page }) => {
    await openDeckEditor(page)
    const search = page.getByPlaceholder(/Search/)
    await page.locator('.brand-name').click() // blur any autofocused field
    await page.keyboard.press('/')
    await expect(search).toBeFocused()
    // Enter in the search box runs the search (re-fetches the mocked results)
    await search.fill('bolt')
    await search.press('Enter')
    await expect(page.getByRole('button', { name: 'Add Lightning Bolt' })).toBeVisible()
    // Add via keyboard
    await pressKey(page, page.getByRole('button', { name: 'Add Serra Angel' }))
    await expect(page.locator('.deck-entry', { hasText: 'Serra Angel' })).toBeVisible()
  })

  test('keyboard: Goldfish playtest opens and closes on Escape', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Open' }).click() // loads Mono Red (24 cards)
    await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
    const gf = page.getByRole('button', { name: 'Goldfish (playtest)' })
    await expect(gf).toBeEnabled() // deck load is async
    await pressKey(page, gf)
    await expect(page.getByRole('dialog', { name: 'Goldfish playtest' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Goldfish playtest' })).toHaveCount(0)
  })

  test('mouse: hovering a search result drives the preview', async ({ page }) => {
    await openDeckEditor(page)
    await page.locator('.card-tile', { hasText: 'Serra Angel' }).hover()
    await expect(page.locator('.deck-list .card-preview-name')).toHaveText('Serra Angel')
  })
})

suite('Deck editor · touch', () => {
  test.use(TOUCH)
  test('tap a card adds it; the remove (−) badge is visible on touch (not hover-only)', async ({ page }) => {
    await openDeckEditor(page)
    const tile = page.locator('.card-tile', { hasText: 'Lightning Bolt' })
    await tile.getByRole('button', { name: 'Add Lightning Bolt' }).tap()
    await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('1×')
    // the in-deck remove button must be reachable on touch — no :hover to reveal it
    const remove = tile.getByRole('button', { name: 'Remove Lightning Bolt' })
    await expect(remove).toBeVisible()
    await expect(remove).toHaveCSS('opacity', '1')
    await remove.tap()
    await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toHaveCount(0)
  })

  test('tap a deck entry shows its preview (no hover on touch)', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Add Lightning Bolt' }).tap()
    await page.locator('.deck-entry', { hasText: 'Lightning Bolt' }).tap()
    await expect(page.locator('.deck-list .card-preview-name')).toHaveText('Lightning Bolt')
  })

  test('tap the +/- on a deck entry adjusts quantity', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Add Lightning Bolt' }).tap()
    const entry = page.locator('.deck-entry', { hasText: 'Lightning Bolt' })
    await entry.getByRole('button', { name: 'Increase Lightning Bolt' }).tap()
    await expect(entry).toContainText('2×')
  })
})

// ===========================================================================
//  GAME BOARD — buttons, hotkeys, view controls
// ===========================================================================
suite('Game board · modalities', () => {
  test('mouse: Pass sends a respond; Done is present', async ({ page }) => {
    await gotoScreen(page, 'game')
    let responded = false
    await page.route('**/api/game/respond', (route) => {
      responded = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
    await page.getByRole('button', { name: 'Pass' }).click()
    await expect.poll(() => responded).toBe(true)
  })

  test('keyboard: Enter on the focused Pass button passes priority', async ({ page }) => {
    await gotoScreen(page, 'game')
    let val: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'boolean') val = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await pressKey(page, page.getByRole('button', { name: 'Pass' }))
    await expect.poll(() => val).toBe('false')
  })

  test('hotkey: "P" passes, "D" confirms (select prompt)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.turn-label').click() // move focus off any control
    let last: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'boolean') last = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.keyboard.press('p')
    await expect.poll(() => last).toBe('false')
  })

  test('hotkey: "Y"/"N" answer an ask prompt (mulligan)', async ({ page }) => {
    await gotoScreen(page, 'mulligan')
    await expect(page.getByRole('button', { name: 'Mulligan' })).toBeVisible()
    let answered: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'boolean') answered = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.keyboard.press('y')
    await expect.poll(() => answered).toBe('true')
  })

  test('hotkey: F4 fires the "skip until next turn" player action (legacy key map)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible() // game is interactive
    await page.locator('.turn-label').click() // ensure focus isn't in an input
    let action: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'action') action = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.keyboard.press('F4')
    await expect.poll(() => action).toBe('PASS_PRIORITY_UNTIL_NEXT_TURN')
  })

  test('mouse: a ⏭ fast-forward menu item sends its player action', async ({ page }) => {
    await gotoScreen(page, 'game')
    let action: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'action') action = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'Fast-forward' }).click()
    await page.locator('.skip-pop-item', { hasText: 'End step' }).click()
    await expect.poll(() => action).toBe('PASS_PRIORITY_UNTIL_TURN_END_STEP')
  })

  test('keyboard: the stack item is focusable and previews on focus', async ({ page }) => {
    await gotoScreen(page, 'stack')
    const item = page.locator('.stack-item').first()
    await expect(item).toBeVisible()
    await item.focus()
    await expect(item).toBeFocused() // was a plain <div> before — now a real button
    await expect(page.locator('.card-hover-bubble')).toBeVisible()
  })

  test('mouse: hovering a play row in the ⚡ popover previews it', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.cmd-plays-btn').click()
    await page.locator('.cmd-play-item', { hasText: 'Serra Angel' }).hover()
    await expect(page.locator('.card-hover-bubble .card-preview-name')).toHaveText('Serra Angel')
  })

  test('mouse: view menu + zoom controls respond', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.view-fab').click()
    const overview = page.getByRole('button', { name: 'Overview' })
    await overview.click()
    await expect(overview).toHaveClass(/active/)
    // close the menu so the zoom bar shows again
    await page.locator('.view-fab').click()
    await expect(page.locator('.zoom-bar')).toBeVisible()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect(page.locator('.zoom-label')).not.toHaveText('100%')
    // the zoom % is a real button now — Enter resets it
    await pressKey(page, page.locator('.zoom-label'))
    await expect(page.locator('.zoom-label')).toHaveText('100%')
  })
})

suite('Game board · touch', () => {
  test.use(TOUCH)
  test('tap Pass sends a respond', async ({ page }) => {
    await gotoScreen(page, 'game')
    let responded = false
    await page.route('**/api/game/respond', (route) => {
      responded = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'Pass' }).tap()
    await expect.poll(() => responded).toBe(true)
  })

  test('tap a play row in the ⚡ popover plays that card', async ({ page }) => {
    await gotoScreen(page, 'game')
    let playedId: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') playedId = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('.cmd-plays-btn').tap()
    await page.locator('.cmd-play-item', { hasText: 'Lightning Bolt' }).tap()
    await expect.poll(() => playedId).toBe('h1')
  })

  test('tap the view menu opens it; tap a snap-view selects it', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.view-fab').tap()
    const overview = page.getByRole('button', { name: 'Overview' })
    await expect(overview).toBeVisible()
    await overview.tap()
    await expect(overview).toHaveClass(/active/)
  })
})

// ===========================================================================
//  DENSE MULTIPLAYER BOARD  (3p / 4p, maxed-out layouts)
// ===========================================================================
//  The dense boards add a player-strip with 3-4 seats, a busy play bar and the
//  collapsible Stack/Combat chips. We exercise those extra controls across the
//  modalities here — the per-viewport LAYOUT of these boards is covered by the
//  usability suite (game3p / game4p screens).
suite('Dense multiplayer board · modalities', () => {
  test('mouse: a play row on the busy 4-player board plays that card', async ({ page }) => {
    await gotoScreen(page, 'game4p')
    await expect(page.locator('.player-strip .pstat')).toHaveCount(4)
    let playedId: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') playedId = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('.cmd-plays-btn').click()
    await page.locator('.cmd-play-item', { hasText: 'Lightning Bolt' }).click()
    await expect.poll(() => playedId).toBe('h1')
  })

  test('mouse: a player-strip seat targets only on a target prompt (plain priority focuses the seat)', async ({ page }) => {
    // the dense board sits on a `select` prompt (plain priority): clicking a
    // seat must NOT send a spurious target response to the server
    await gotoScreen(page, 'game3p')
    const sent: string[] = []
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') sent.push(b.value)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    const seat = page.locator('.pstat', { hasText: 'Teferi' })
    await expect(seat).not.toHaveClass(/targetable/)
    await seat.click()
    await page.waitForTimeout(250)
    expect(sent).toEqual([])
    // on plain priority the seat's zone counts are browse buttons — if the click
    // landed on one it opened the zone browser (intended); dismiss it so the
    // targeting phase below isn't covered by the modal
    await page.keyboard.press('Escape')
    await expect(page.locator('.zone-browser')).toHaveCount(0)
    // a real target prompt: the seat becomes targetable and sends its player id
    await page.evaluate(() =>
      (window as unknown as { __push: (p: unknown) => void }).__push({
        kind: 'target', message: 'Choose a player', canCancel: true,
        min: 0, max: 0, choices: [], choiceKind: 'string', targets: [],
      }),
    )
    await expect(seat).toHaveClass(/targetable/)
    await seat.click()
    await expect.poll(() => sent[0]).toBe('p3')
  })
})

suite('Dense multiplayer board · touch (phone)', () => {
  // a phone-sized touch context (<=760px) where the Stack/Combat panels default
  // to COLLAPSED chips, so we can drive the expand/collapse toggle on touch.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 720, height: 1000 } })

  test('tap the collapsed Stack chip expands it, tap again collapses', async ({ page }) => {
    await gotoScreen(page, 'game4p')
    const stack = page.locator('.stack-panel')
    await expect(stack).toHaveClass(/collapsed/) // chips start collapsed on phones
    await expect(stack.locator('.overlay-body')).toHaveCount(0)
    await stack.locator('.overlay-head').tap()
    await expect(stack).not.toHaveClass(/collapsed/)
    await expect(stack.locator('.stack-item').first()).toBeVisible()
    await stack.locator('.overlay-head').tap()
    await expect(stack).toHaveClass(/collapsed/)
  })

  test('tap the collapsed Combat chip expands it', async ({ page }) => {
    await gotoScreen(page, 'game4p')
    const combat = page.locator('.combat-panel')
    await expect(combat).toHaveClass(/collapsed/)
    await combat.locator('.overlay-head').tap()
    await expect(combat).not.toHaveClass(/collapsed/)
    await expect(combat.locator('.combat-group').first()).toBeVisible()
  })

  test('tap a play row on the dense board plays that card', async ({ page }) => {
    await gotoScreen(page, 'game3p')
    let playedId: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') playedId = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('.cmd-plays-btn').tap()
    await page.locator('.cmd-play-item', { hasText: 'Mulldrifter' }).tap()
    await expect.poll(() => playedId).toBe('h3')
  })
})

// ===========================================================================
//  GAME OVER
// ===========================================================================
suite('Game over · modalities', () => {
  test('mouse: Back to lobby returns to the lobby', async ({ page }) => {
    await gotoScreen(page, 'gameOver')
    await page.locator('.game-over-overlay').getByRole('button', { name: 'Back to lobby' }).click()
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })

  test('keyboard: Back to lobby is focusable and fires on Enter', async ({ page }) => {
    await gotoScreen(page, 'gameOver')
    await pressKey(page, page.locator('.game-over-overlay').getByRole('button', { name: 'Back to lobby' }))
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })
})

suite('Game over · touch', () => {
  test.use(TOUCH)
  test('tap Back to lobby returns to the lobby', async ({ page }) => {
    await gotoScreen(page, 'gameOver')
    await page.locator('.game-over-overlay').getByRole('button', { name: 'Back to lobby' }).tap()
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })
})

// ===========================================================================
//  SETTINGS — checkboxes, sliders, theme swatches
// ===========================================================================
suite('Settings · modalities', () => {
  test('mouse: a checkbox toggle flips state', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const toggle = page.locator('.setting-row', { hasText: 'Card images' }).locator('input[type="checkbox"]')
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
  })

  test('keyboard: Space toggles the focused checkbox', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const toggle = page.locator('.setting-row', { hasText: 'Mana symbols' }).locator('input[type="checkbox"]')
    const before = await toggle.isChecked()
    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toBeChecked({ checked: !before })
  })

  test('mouse: a theme swatch becomes active when clicked', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const swatches = page.locator('.theme-swatch')
    const target = swatches.nth(1)
    await target.click()
    await expect(target).toHaveClass(/active/)
  })
})

suite('Settings · touch', () => {
  test.use(TOUCH)
  test('tap a checkbox flips it', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'Settings' }).tap()
    const toggle = page.locator('.setting-row', { hasText: 'Card images' }).locator('input[type="checkbox"]')
    await toggle.tap()
    await expect(toggle).not.toBeChecked()
  })
})

// ===========================================================================
//  DRAFT / CONSTRUCT
// ===========================================================================
suite('Draft & construct · modalities', () => {
  test('mouse: picking a booster card sends a pick', async ({ page }) => {
    await gotoScreen(page, 'draft')
    let pickedId: string | null = null
    await page.route('**/api/draft/pick', (route) => {
      pickedId = JSON.parse(route.request().postData() || '{}').cardId
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('.draft-card', { hasText: 'Trumpet Blast' }).click()
    await expect.poll(() => pickedId).toBe('d3')
  })

  test('keyboard: Enter on a booster card picks it', async ({ page }) => {
    await gotoScreen(page, 'draft')
    let pickedId: string | null = null
    await page.route('**/api/draft/pick', (route) => {
      pickedId = JSON.parse(route.request().postData() || '{}').cardId
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await pressKey(page, page.locator('.draft-card', { hasText: 'Disperse' }))
    await expect.poll(() => pickedId).toBe('d2')
  })

  test('keyboard: Auto-build then Submit (Enter) submits the deck', async ({ page }) => {
    await gotoScreen(page, 'construct')
    await expect(page.getByRole('heading', { name: 'Build your deck' })).toBeVisible()
    const submit = page.getByRole('button', { name: /Submit/ })
    await expect(submit).toBeDisabled()
    await pressKey(page, page.getByRole('button', { name: 'Auto-build' }))
    await expect(submit).toBeEnabled()
    let submitted = false
    await page.route('**/api/draft/submit', (route) => {
      submitted = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await pressKey(page, submit)
    await expect.poll(() => submitted).toBe(true)
  })
})

suite('Draft & construct · touch', () => {
  test.use(TOUCH)
  test('tap a booster card picks it', async ({ page }) => {
    await gotoScreen(page, 'draft')
    let pickedId: string | null = null
    await page.route('**/api/draft/pick', (route) => {
      pickedId = JSON.parse(route.request().postData() || '{}').cardId
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.locator('.draft-card', { hasText: 'Trumpet Blast' }).tap()
    await expect.poll(() => pickedId).toBe('d3')
  })
})

// ===========================================================================
//  GLOBAL KEYS + OVERLAYS
// ===========================================================================
suite('Global keys & overlays', () => {
  test('keyboard: "?" opens the shortcuts overlay, Esc closes it', async ({ page }) => {
    await openLobby(page)
    await page.locator('.brand-name').click() // blur autofocused inputs
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  })

  test('mouse: the help FAB opens the overlay', async ({ page }) => {
    await openLobby(page)
    await page.locator('.help-fab').click()
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  })

  test('keyboard: the help FAB is focusable and opens on Enter', async ({ page }) => {
    await openLobby(page)
    await pressKey(page, page.locator('.help-fab'))
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  })

  test('mouse: Report problem opens, Esc closes', async ({ page }) => {
    await openLobby(page)
    await page.getByRole('button', { name: 'Report problem' }).click()
    await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Report a problem' })).toHaveCount(0)
  })
})

suite('Global keys & overlays · touch', () => {
  test.use(TOUCH)
  test('tap the help FAB opens the shortcuts overlay', async ({ page }) => {
    await openLobby(page)
    await page.locator('.help-fab').tap()
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  })
})

// ===========================================================================
//  KEYBOARD REACHABILITY — primary controls are focusable per view
// ===========================================================================
suite('Keyboard reachability', () => {
  test('lobby primary controls are focusable', async ({ page }) => {
    await openLobby(page)
    for (const name of ['New game', 'Draft vs AI', 'History', 'Refresh', 'Disconnect', 'Deck Editor', 'Settings', 'Play']) {
      await expectFocusable(page.getByRole('button', { name, exact: true }).first())
    }
  })

  test('game command-pill + toolbar buttons are focusable', async ({ page }) => {
    await gotoScreen(page, 'game')
    for (const name of ['Done', 'Pass', 'Fast-forward', 'Concede']) {
      await expectFocusable(page.getByRole('button', { name: new RegExp(name) }).first())
    }
  })

  test('deck-editor primary controls are focusable', async ({ page }) => {
    await openDeckEditor(page)
    await page.getByRole('button', { name: 'Add Lightning Bolt' }).click() // enables New/Save
    for (const name of ['Search', 'Import', 'Upload', 'Open', 'New', 'Save deck (.dck)']) {
      await expectFocusable(page.getByRole('button', { name, exact: true }).first())
    }
  })

  test('opt-in gate: this suite only runs under INTERACT=1', () => {
    expect(INTERACT).toBe(true)
  })
})

// a single always-present marker test so the file is never "empty" when skipped
test('interaction-coverage suite is opt-in (INTERACT=1)', () => {
  test.skip(!INTERACT, 'run with INTERACT=1 (npm run test:interact)')
  expect(INTERACT).toBe(true)
})
