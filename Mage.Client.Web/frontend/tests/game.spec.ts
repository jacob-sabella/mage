import { test, expect } from '@playwright/test'
import { gotoScreen, gotoCustomGame, SAMPLE } from './harness'

test.describe('Game board (3D)', () => {
  test('renders the 3D board and player status strip', async ({ page }) => {
    await gotoScreen(page, 'game')

    // the three.js canvas mounts
    await expect(page.locator('.board3d canvas')).toBeVisible()

    // status strip: both players with their life totals
    await expect(page.locator('.pstat', { hasText: 'Computer' })).toContainText('18')
    await expect(page.locator('.pstat', { hasText: 'You' })).toContainText('20')

    // snap-view controls live in the radial view menu (collapsed by default); the
    // per-seat Focus row only applies to the manual 3D camera, so select it first
    await page.locator('.view-fab').click()
    await page.locator('.view-radial.mode', { hasText: '3D' }).click()
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible()

    // floating mana pool shown as pips for the viewer ({U}{U}{R} -> 3 pips)
    await expect(page.locator('.pstat', { hasText: 'You' }).locator('.mana-pip')).toHaveCount(3)
  })

  test('priority prompt offers Pass and Done; skip bar + log present', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Turn/ })).toBeVisible()
    // the game log now lives as a tab in the chat panel, not floating on the board
    await page.getByRole('tab', { name: 'Game log' }).click()
    await expect(page.locator('.chat-log')).toContainText('Precombat Main')
    // entries are grouped under a turn separator (game is on turn 3)
    await expect(page.locator('.game-log-turn')).toContainText('Turn 3')
  })

  test('passing priority sends a respond and is accepted', async ({ page }) => {
    await gotoScreen(page, 'game')
    // register AFTER the harness so this handler wins for the respond call
    let responded = false
    await page.route('**/api/game/respond', (route) => {
      responded = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'Pass' }).click()
    await expect.poll(() => responded).toBe(true)
  })

  test('concede asks for confirmation in-app; confirming sends concede', async ({ page }) => {
    await gotoScreen(page, 'game')
    let conceded = false
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'concede') conceded = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'Concede' }).click()
    // a styled dialog appears (not a native confirm) and nothing is sent yet
    const dialog = page.locator('.confirm-overlay')
    await expect(dialog).toBeVisible()
    expect(conceded).toBe(false)
    // cancelling closes it without conceding
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(conceded).toBe(false)
    // re-open and confirm → concede is sent
    await page.getByRole('button', { name: 'Concede' }).click()
    await page.locator('.confirm-overlay').getByRole('button', { name: 'Concede' }).click()
    await expect.poll(() => conceded).toBe(true)
  })

  test('playable bar lists castable cards and plays one by name', async ({ page }) => {
    await gotoScreen(page, 'game')
    const bar = page.locator('.playable-bar')
    await expect(bar.getByRole('button', { name: 'Lightning Bolt' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Serra Angel' })).toBeVisible()

    let playedId: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') playedId = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await bar.getByRole('button', { name: 'Lightning Bolt' }).click()
    await expect.poll(() => playedId).toBe('h1')
  })

  test('mulligan prompt offers Mulligan/Keep and strips HTML from the message', async ({ page }) => {
    await gotoScreen(page, 'mulligan')
    // server sends "Mulligan <font ...>down to 6 cards</font>?" — must render clean
    await expect(page.locator('.action-message')).toHaveText('Mulligan down to 6 cards?')
    await expect(page.locator('.action-message')).not.toContainText('<font')
    // a mulligan ask reads clearer as Mulligan / Keep than Yes / No
    await expect(page.getByRole('button', { name: 'Mulligan' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep' })).toBeVisible()
  })

  test('combat: declare-attackers prompt + clicking a creature declares it', async ({ page }) => {
    await gotoScreen(page, 'combat')
    await expect(page.getByText(/Declare attackers/)).toBeVisible()
    // my creature (Serra Angel) is offered as a declarable; clicking sends its id
    const bar = page.locator('.playable-bar')
    await expect(bar.getByRole('button', { name: 'Serra Angel' })).toBeVisible()

    let declaredId: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') declaredId = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await bar.getByRole('button', { name: 'Serra Angel' }).click()
    await expect.poll(() => declaredId).toBe('b3')
  })

  test('action arrows: declared combat renders the board + combat overlay', async ({ page }) => {
    await gotoScreen(page, 'arrows')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    // the combat relationship that drives the on-board arrows is also surfaced as text
    const combat = page.locator('.combat-panel')
    await expect(combat).toBeVisible()
    await expect(combat).toContainText('Computer')
    await expect(combat).toContainText(/blocked by/)

    // the actual on-board 3D arrows must render too: Serra Angel (b3) attacks the
    // Computer but is BLOCKED by Goblin Guide (a2) → a gray attackBlocked arrow +
    // a block arrow, and the paired target prompt draws a targeting arrow.
    const readArrows = () =>
      page.evaluate(
        () =>
          (window as unknown as { __board3d?: { arrows: () => { kind: string; onScreen: boolean }[] } }).__board3d?.arrows() ??
          [],
      )
    await expect.poll(async () => (await readArrows()).map((a) => a.kind).sort()).toEqual(['attackBlocked', 'block', 'target'])
    // and they must actually land on-screen, not just exist in the scene graph
    // (poll: the camera glide takes longer on slow CI runners)
    await expect.poll(async () => (await readArrows()).every((a) => a.onScreen)).toBe(true)
  })

  test('pile choice shows both piles and picks one (boolean)', async ({ page }) => {
    await gotoScreen(page, 'pile')
    await expect(page.getByText(/Fact or Fiction/)).toBeVisible()
    await expect(page.locator('.pile').first().getByText('Mulldrifter')).toBeVisible()
    await expect(page.locator('.pile').nth(1).getByText('Counterspell')).toBeVisible()

    let picked: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'boolean') picked = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'Take pile 1' }).click()
    await expect.poll(() => picked).toBe('true')
  })

  test('multi-amount: distribute, gated on total, sends space-joined string', async ({ page }) => {
    await gotoScreen(page, 'multiAmount')
    await expect(page.getByText(/Distribute 3 damage/)).toBeVisible()
    const inputs = page.locator('.multi-input')
    await expect(inputs).toHaveCount(2)
    // OK disabled until the total matches (need 3)
    const ok = page.getByRole('button', { name: 'OK' })
    await expect(ok).toBeDisabled()
    await inputs.nth(0).fill('2')
    await inputs.nth(1).fill('1')
    await expect(ok).toBeEnabled()

    let sent: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'string') sent = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await ok.click()
    await expect.poll(() => sent).toBe('2 1')
  })

  test('target prompt shows the choose-a-target hint', async ({ page }) => {
    await gotoScreen(page, 'target')
    await expect(page.getByText('Choose a target', { exact: false })).toBeVisible()
  })

  test('creatures show a P/T badge (not lands)', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
    // in-canvas P/T sprites: Serra Angel 4/4 exists + is on-screen; lands get no 0/0
    const badges = () => page.evaluate(() => (window as unknown as { __board3d: { badges(): { text: string; onScreen: boolean }[] } }).__board3d.badges())
    await expect.poll(async () => (await badges()).filter((b) => b.text === '4/4').length).toBe(1)
    await expect.poll(async () => (await badges()).some((b) => b.text === '4/4' && b.onScreen)).toBe(true)
    expect((await badges()).some((b) => b.text === '0/0')).toBe(false)
  })

  test('a P/T change pushed by the server updates the on-board badge', async ({ page }) => {
    await gotoScreen(page, 'ptUpdate')
    await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
    const badges = () => page.evaluate(() => (window as unknown as { __board3d: { badges(): { text: string }[] } }).__board3d.badges())
    // server pushes a buffed board ~0.5s later → the 4/4 badge becomes 6/6
    await expect.poll(async () => (await badges()).some((b) => b.text === '6/6')).toBe(true)
    expect((await badges()).some((b) => b.text === '4/4')).toBe(false)
  })

  // Regression: the bottom control dock used to change height turn-to-turn as
  // its contents changed (playable-card count, prompt-message length), which is
  // jarring. On roomy screens it now holds a constant height.
  test('the control dock keeps a constant height as its contents change', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 810 })
    const dockH = () => page.locator('.control-dock').evaluate((el) => Math.round(el.getBoundingClientRect().height))

    // a) default sample — a few playable cards
    await gotoScreen(page, 'game')
    await page.getByRole('button', { name: /^Pass/ }).waitFor()
    const withPlayables = await dockH()

    // b) same board but nothing is castable → the playable bar is gone
    const g = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
    g.canPlay = []
    await gotoCustomGame(page, g)
    await page.getByRole('button', { name: /^Pass/ }).waitFor()
    const noPlayables = await dockH()

    // c) a declare-attackers prompt (a longer, 2-line message)
    await gotoScreen(page, 'combat')
    await page.locator('.control-dock').waitFor()
    const combat = await dockH()

    expect(noPlayables, `dock: ${withPlayables} with playables vs ${noPlayables} without`).toBe(withPlayables)
    expect(combat, `dock: ${withPlayables} normal vs ${combat} combat`).toBe(withPlayables)
    // and the page never scrolls sideways because of the non-wrapping dock
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2)
  })

  test('hand cards show mana-cost pips', async ({ page }) => {
    await gotoScreen(page, 'game')
    // mana cost shows on each hand-fan card: Counterspell {U}{U}, Lightning Bolt {R}
    await expect(page.locator('.hand-card-cost .mana-pip').first()).toBeVisible()
    await expect(page.locator('.hand-card-cost .mana-pip', { hasText: 'U' }).first()).toBeVisible()
  })

  test('hovering a card shows the read-out bubble BESIDE the hover point', async ({ page }) => {
    await gotoScreen(page, 'game')
    // no bubble until hover; the old fixed corner panel is gone for good
    await expect(page.locator('.card-hover-bubble')).toHaveCount(0)
    await expect(page.locator('.board-wrap .card-preview')).toHaveCount(0)
    // hover the Serra Angel chip in the playable bar (a 4/4 creature)
    const chip = page.locator('.play-chip', { hasText: 'Serra Angel' })
    await chip.hover()
    const bubble = page.locator('.card-hover-bubble')
    await expect(bubble).toBeVisible()
    await expect(bubble.locator('.card-preview-name')).toHaveText('Serra Angel')
    await expect(bubble.locator('.card-preview-pt')).toHaveText('4/4')
    // the bubble sits near the hover point (not pinned in a far corner) and
    // fully on screen
    const chipBox = (await chip.boundingBox())!
    const bb = (await bubble.boundingBox())!
    const cx = chipBox.x + chipBox.width / 2
    const cy = chipBox.y + chipBox.height / 2
    const nearestX = Math.max(bb.x, Math.min(cx, bb.x + bb.width))
    const nearestY = Math.max(bb.y, Math.min(cy, bb.y + bb.height))
    const dist = Math.hypot(nearestX - cx, nearestY - cy)
    expect(dist, `bubble is ${Math.round(dist)}px from the hover point`).toBeLessThan(120)
    const vp = page.viewportSize()!
    expect(bb.x).toBeGreaterThanOrEqual(0)
    expect(bb.y).toBeGreaterThanOrEqual(0)
    expect(bb.x + bb.width).toBeLessThanOrEqual(vp.width)
    expect(bb.y + bb.height).toBeLessThanOrEqual(vp.height)
    // its rules text is actually readable (>= 14px)
    await chip.hover() // keep the hover alive
    const rulesSize = await bubble.locator('.card-preview-rules p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize)).catch(() => 14)
    expect(rulesSize).toBeGreaterThanOrEqual(14)
    // moving away hides it
    await page.locator('.playable-label').hover()
    await expect(page.locator('.card-hover-bubble')).toHaveCount(0)
  })

  // Regression: in the maximized board (⛶, html.board-max) the toolbar becomes
  // a fixed top bar — the stack rail's normal top:12 landed under it, and the
  // floating chat toggle (z-raised, in-flow at the top right) stacked onto
  // Concede and the exit ✕. Everything in that corner must stay disjoint.
  test('maximized board: toolbar, stack rail, chat toggle and exit do not overlap', async ({ page }) => {
    await gotoScreen(page, 'stack') // populated stack → the top-right rail renders
    await page.locator('.board3d canvas').waitFor()
    await page.getByRole('button', { name: 'Maximize board' }).click()
    await expect(page.locator('html.board-max')).toHaveCount(1)
    const chatFab = page.locator('.chat-reopen')
    await expect(chatFab).toBeVisible() // maximizing collapses chat to the toggle
    const boxes: { label: string; box: { x: number; y: number; width: number; height: number } }[] = []
    const parts: [string, ReturnType<typeof page.locator>][] = [
      ['Concede', page.getByRole('button', { name: 'Concede' })],
      ['exit-maximize', page.getByRole('button', { name: 'Exit maximized board' })],
      ['chat-toggle', chatFab],
      ['stack-rail', page.locator('.overlay-tr')],
      ['priority-chip', page.locator('.prio-chip')],
    ]
    for (const [label, loc] of parts) {
      if ((await loc.count()) === 0) continue
      const box = await loc.first().boundingBox()
      if (box) boxes.push({ label, box })
    }
    expect(boxes.length).toBeGreaterThanOrEqual(4)
    const TOL = 2
    const errs: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box
        const b = boxes[j].box
        const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (ix > TOL && iy > TOL) errs.push(`${boxes[i].label} overlaps ${boxes[j].label}`)
      }
    }
    expect(errs, errs.join(' | ')).toEqual([])
    // and the maximized layout must not overflow the page horizontally
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(2)
  })

  test('the hover bubble flips to stay on screen at the right edge', async ({ page }) => {
    await gotoScreen(page, 'stack')
    const vp = page.viewportSize()!
    // park the pointer at the far right edge — a focus-preview anchors to the
    // last pointer position, so this forces the "no room on the right" case
    await page.mouse.move(vp.width - 4, vp.height / 2)
    const item = page.locator('.stack-item').first()
    await item.focus()
    const bubble = page.locator('.card-hover-bubble')
    await expect(bubble).toBeVisible()
    // the bubble must flip to the LEFT of the anchor and stay fully on screen
    const bb = (await bubble.boundingBox())!
    expect(bb.x + bb.width).toBeLessThanOrEqual(vp.width)
    expect(bb.x).toBeGreaterThanOrEqual(0)
    expect(bb.x + bb.width, 'bubble should sit left of the right-edge anchor').toBeLessThan(vp.width - 4)
  })

  test('hand grid: opens a grouped, readable overlay and regroups by attribute', async ({ page }) => {
    await gotoScreen(page, 'game')
    // no overlay until the grid icon is used
    await expect(page.locator('.hand-grid-overlay')).toHaveCount(0)
    await page.getByRole('button', { name: 'View hand as a grid' }).click()
    const overlay = page.locator('.hand-grid-overlay')
    await expect(overlay).toBeVisible()
    // every hand card is present as a big non-overlapping tile (SAMPLE hand = 4)
    await expect(overlay.locator('.hand-grid-card')).toHaveCount(4)
    // default grouping is Type — Lightning Bolt (Instant) and Mountain (Land)
    // land in different sections
    await expect(overlay.locator('.hand-grid-section-head', { hasText: /Instant/i })).toBeVisible()
    await expect(overlay.locator('.hand-grid-section-head', { hasText: /Land/i })).toBeVisible()
    // the tiles are actually large (readability) — >= 110px wide
    const tile = overlay.locator('.hand-grid-card').first()
    const box = (await tile.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(110)
    // regroup by colour — sections change to colour buckets
    await overlay.getByLabel('Group hand by').selectOption('color')
    await expect(overlay.locator('.hand-grid-section-head', { hasText: /^\s*Red/i }).first()).toBeVisible()
    await expect(overlay.locator('.hand-grid-card')).toHaveCount(4)
    // choice persists to localStorage
    expect(await page.evaluate(() => localStorage.getItem('mage.handGroupBy'))).toBe('color')
    // Esc closes it
    await page.keyboard.press('Escape')
    await expect(page.locator('.hand-grid-overlay')).toHaveCount(0)
  })

  test('hand grid: usable in maximized board and centred with the close visible', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.board3d canvas').waitFor()
    await page.getByRole('button', { name: 'Maximize board' }).click()
    await expect(page.locator('html.board-max')).toHaveCount(1)
    // the Grid toggle must be reachable in fullscreen (was buried under the dock)
    const toggle = page.getByRole('button', { name: 'View hand as a grid' })
    await expect(toggle).toBeVisible()
    const tBox = (await toggle.boundingBox())!
    const vp = page.viewportSize()!
    // it hit-tests to itself (not covered by the control dock)
    const covered = await toggle.evaluate((node, b) => {
      const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
      return !(e && (e === node || node.contains(e)))
    }, tBox)
    expect(covered, 'grid toggle is covered in fullscreen').toBe(false)
    await toggle.click()
    const overlay = page.locator('.hand-grid-overlay')
    await expect(overlay).toBeVisible()
    // the close button and the whole panel sit within the viewport
    const box = (await overlay.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
    await expect(overlay.getByRole('button', { name: 'Close hand grid' })).toBeVisible()
    // roughly horizontally centred (within 40px of viewport centre)
    const cx = box.x + box.width / 2
    expect(Math.abs(cx - vp.width / 2)).toBeLessThan(40)
    // clicking the scrim (open board area, left of the centred panel) closes it
    await page.locator('.hand-grid-scrim').click({ position: { x: 80, y: Math.round(vp.height / 2) } })
    await expect(page.locator('.hand-grid-overlay')).toHaveCount(0)
  })

  test('hand grid: clicking a playable card sends a respond', async ({ page }) => {
    await gotoScreen(page, 'game')
    let body: { kind?: string; value?: string } | null = null
    await page.route('**/api/game/respond', (route) => {
      try {
        body = route.request().postDataJSON()
      } catch {
        body = {}
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('button', { name: 'View hand as a grid' }).click()
    // Lightning Bolt is castable in the SAMPLE hand — its tile carries .playable
    const bolt = page.locator('.hand-grid-card.playable', { hasText: 'Lightning Bolt' }).first()
    await expect(bolt).toBeVisible()
    await bolt.click()
    // grid cards share the fan's action path → a respond for that card id (h1)
    await expect.poll(() => body).not.toBeNull()
    expect(body!.kind).toBe('uuid')
    expect(body!.value).toBe('h1')
  })

  test('H collapses the hand to a pill and restores it', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.locator('.hand-fan')).toBeVisible()
    await page.locator('.turn-label').click()
    await page.keyboard.press('h')
    await expect(page.locator('.hand-fan')).toHaveCount(0)
    const pill = page.getByRole('button', { name: /Hand \(4\)/ })
    await expect(pill).toBeVisible()
    await pill.click()
    await expect(page.locator('.hand-fan')).toBeVisible()
  })

  test('the preview shows oracle text when the server ships it', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.play-chip', { hasText: 'Lightning Bolt' }).hover()
    await expect(page.locator('.card-preview-rules')).toContainText('deals 3 damage to any target')
  })

  test('snap-view buttons switch the active view', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.view-fab').click()
    await page.locator('.view-radial.mode', { hasText: '3D' }).click()
    const overview = page.getByRole('button', { name: 'Overview' })
    await overview.click()
    await expect(overview).toHaveClass(/active/)
  })

  test('desktop maximize: hides the site chrome and fills the window; Esc exits', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.locator('.board3d canvas')).toBeVisible()

    const maxBtn = page.getByRole('button', { name: 'Maximize board' })
    await expect(maxBtn).toBeVisible()
    await maxBtn.click()

    await expect(page.locator('html.board-max')).toHaveCount(1)
    // website chrome + the separate outer backdrop canvas are gone
    await expect(page.locator('.topbar')).toBeHidden()
    await expect(page.locator('.app-nav')).toBeHidden()
    await expect(page.locator('.lobby-header')).toBeHidden()
    await expect(page.locator('.scene-bg')).toBeHidden()

    // the board fills the whole viewport
    const vp = page.viewportSize()!
    const box = (await page.locator('.board-wrap').boundingBox())!
    expect(box.width).toBeGreaterThan(vp.width - 4)
    expect(box.height).toBeGreaterThan(vp.height - 4)

    // Esc leaves maximized and the chrome comes back
    await page.keyboard.press('Escape')
    await expect(page.locator('html.board-max')).toHaveCount(0)
    await expect(page.locator('.topbar')).toBeVisible()
  })

  test('hand fan: your hand sits in a fixed bottom fan; a playable card plays', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.locator('.board3d canvas')).toBeVisible()

    const fan = page.locator('.hand-fan')
    await expect(fan).toBeVisible()
    // sample hand = Lightning Bolt, Mountain, Mulldrifter, Counterspell
    await expect(fan.locator('.hand-card')).toHaveCount(4)
    // only the castable ones (canPlay: h1 Bolt, h3 Mulldrifter) glow
    await expect(fan.locator('.hand-card.playable')).toHaveCount(2)

    let played: string | null = null
    await page.route('**/api/game/respond', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.kind === 'uuid') played = b.value
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await fan.getByRole('button', { name: /Lightning Bolt/ }).click()
    await expect.poll(() => played).toBe('h1')
  })

  test('hand size preference scales the hand fan', async ({ page }) => {
    await gotoScreen(page, 'game')
    const card = page.locator('.hand-card').first()
    await expect(card).toBeVisible()
    const wMed = (await card.boundingBox())!.width

    // bump it to Large in Settings, then return to the board
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Large' }).click()
    await expect(page.locator('html[data-hand-size="large"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Play', exact: true }).click()

    const wLarge = (await page.locator('.hand-card').first().boundingBox())!.width
    expect(wLarge).toBeGreaterThan(wMed + 10)
  })

  test('board zoom preference sets the starting zoom', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mage.prefs', JSON.stringify({ boardZoom: 1.5 })))
    await gotoScreen(page, 'game')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __board3d: { zoom(): number } }).__board3d.zoom()))
      .toBe(1.5)
  })

  test('default camera preference sets the starting board view', async ({ page }) => {
    // seed the pref before the app loads so the board mounts in 2D
    await page.addInitScript(() => localStorage.setItem('mage.prefs', JSON.stringify({ defaultCamera: '2d' })))
    await gotoScreen(page, 'game')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __board3d: { mode(): string } }).__board3d.mode()))
      .toBe('2d')
  })

  test('clicking a player (no targeting) focuses the camera on their board', async ({ page }) => {
    // mulligan = an "ask" prompt, so the player strip isn't in targeting mode
    await gotoScreen(page, 'mulligan')
    await expect(page.locator('.board3d canvas')).toBeVisible()
    await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15000 })
    const mode = () => page.evaluate(() => (window as unknown as { __board3d: { mode(): string } }).__board3d.mode())
    // desktop default is the cinematic Auto cam
    await expect.poll(mode).toBe('auto')
    // clicking the opponent swings to the manual 3D seat view
    await page.locator('.pstat', { hasText: 'Computer' }).click()
    await expect.poll(mode).toBe('3d')
  })

  test('hand fan: arrow keys move focus between cards', async ({ page }) => {
    await gotoScreen(page, 'game')
    const fan = page.locator('.hand-fan')
    await expect(fan).toBeVisible()
    const cards = fan.locator('.hand-card')
    await cards.nth(0).focus()
    await expect(cards.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(cards.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(cards.nth(0)).toBeFocused()
    // doesn't wrap past the first card
    await page.keyboard.press('ArrowLeft')
    await expect(cards.nth(0)).toBeFocused()
  })

  test('view menu offers Auto / 2D / 3D / free camera modes', async ({ page }) => {
    await gotoScreen(page, 'game')
    await page.locator('.view-fab').click()
    await expect(page.locator('.view-radial.mode')).toHaveCount(4)
    await page.locator('.view-radial.mode', { hasText: '2D' }).click()
    await expect(page.locator('.view-radial.mode.active', { hasText: '2D' })).toBeVisible()
    // cinematic auto-cam mode is selectable (menu stays open after a mode click)
    await page.locator('.view-radial.mode', { hasText: 'Auto' }).click()
    await expect(page.locator('.view-radial.mode.active', { hasText: 'Auto' })).toBeVisible()
  })
})

test.describe('Game over', () => {
  test('shows a result overlay and returns to the lobby', async ({ page }) => {
    await gotoScreen(page, 'gameOver')
    const overlay = page.locator('.game-over-overlay')
    await expect(overlay).toBeVisible()
    // a win reads as "Victory" (not the generic "Game over"), with the detail below
    await expect(overlay.locator('.game-over-title')).toHaveText('Victory')
    await expect(overlay.locator('.game-over-card')).toHaveClass(/game-over-win/)
    await expect(overlay).toContainText('You have won the game')
    await overlay.getByRole('button', { name: 'Back to lobby' }).click()
    // back to the lobby
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })
})

test.describe('Multiplayer (Free For All)', () => {
  test('renders 4 seats, player strip, and a view button per player', async ({ page }) => {
    await gotoScreen(page, 'multiplayer')

    // board mounts
    await expect(page.locator('.board3d canvas')).toBeVisible()

    // all four players appear in the status strip with their life totals
    await expect(page.locator('.pstat')).toHaveCount(4)
    await expect(page.locator('.pstat', { hasText: 'You' })).toContainText('20')
    await expect(page.locator('.pstat', { hasText: 'Chandra' })).toContainText('17')
    await expect(page.locator('.pstat', { hasText: 'Teferi' })).toContainText('22')
    await expect(page.locator('.pstat', { hasText: 'Vraska' })).toContainText('14')

    // a snap-view per seat (Overview + 4 players) inside the radial menu's 3D Focus row
    await page.locator('.view-fab').click()
    await page.locator('.view-radial.mode', { hasText: '3D' }).click()
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible()
    await expect(page.locator('.view-menu .view-radial.focus')).toHaveCount(5)
  })

  test('can target any opponent in a multiplayer game', async ({ page }) => {
    await gotoScreen(page, 'multiplayer')
    await page.locator('.view-fab').click()
    await page.locator('.view-radial.mode', { hasText: '3D' }).click()
    // the active player can switch the camera to each opponent's seat
    await page.locator('.view-radial', { hasText: 'Vraska' }).click()
    await expect(page.locator('.view-radial.active', { hasText: 'Vraska' })).toBeVisible()
  })

  // Regression: the fab used a native `title` tooltip that the browser painted
  // OVER the open camera panel. It's now a controlled tooltip that shows on
  // hover (panel closed) and is removed entirely while the panel is open, so it
  // can never cover the panel's controls.
  test('view-options tooltip is styled and never covers the open panel', async ({ page }) => {
    await gotoScreen(page, 'game')
    const fab = page.locator('.view-fab')
    await fab.waitFor()
    // the un-styleable native title is gone
    expect(await fab.getAttribute('title')).toBeNull()

    // closed + hovered → the styled tip fades in to full opacity
    await fab.hover()
    const tip = page.locator('.view-fab-tip')
    await expect(tip).toHaveText('View options')
    await expect
      .poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity))
      .toBe('1')

    // open the panel → the tip is unmounted, so it cannot overlap the panel
    await fab.click()
    await expect(page.locator('.view-panel')).toBeVisible()
    await expect(page.locator('.view-fab-tip')).toHaveCount(0)

    // every mode button hit-tests to itself (nothing painted on top)
    for (const label of ['Auto', '3D', '2D', 'Free']) {
      const btn = page.locator('.view-radial.mode', { hasText: new RegExp(`^${label}$`) }).first()
      const box = await btn.boundingBox()
      expect(box, `${label} button present`).toBeTruthy()
      const covered = await btn.evaluate((node, b) => {
        const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
        return !(e && (e === node || node.contains(e)))
      }, box!)
      expect(covered, `${label} is covered by something on top`).toBe(false)
    }
  })
})
