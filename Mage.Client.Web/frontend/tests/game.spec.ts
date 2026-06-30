import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

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
    await expect(page.getByRole('button', { name: /Next turn/ })).toBeVisible()
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
    // Computer (attack arrow), blocked by Goblin Guide (a2) (block arrow), and the
    // paired target prompt draws a targeting arrow — three in all.
    const readArrows = () =>
      page.evaluate(
        () =>
          (window as unknown as { __board3d?: { arrows: () => { kind: string; onScreen: boolean }[] } }).__board3d?.arrows() ??
          [],
      )
    await expect.poll(async () => (await readArrows()).map((a) => a.kind).sort()).toEqual(['attack', 'block', 'target'])
    // and they must actually land on-screen, not just exist in the scene graph
    expect((await readArrows()).every((a) => a.onScreen)).toBe(true)
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
    // Serra Angel 4/4 (battlefield) is uniquely identifiable
    await expect(page.locator('.c3d-pt', { hasText: '4/4' })).toHaveCount(1)
    await expect(page.locator('.c3d-pt').first()).toBeVisible()
    // lands must not get a 0/0 badge
    await expect(page.locator('.c3d-pt', { hasText: '0/0' })).toHaveCount(0)
  })

  test('a P/T change pushed by the server updates the on-board badge', async ({ page }) => {
    await gotoScreen(page, 'ptUpdate')
    // server pushes a buffed board ~0.5s later → the 4/4 badge becomes 6/6
    await expect(page.locator('.c3d-pt', { hasText: '6/6' })).toHaveCount(1)
    await expect(page.locator('.c3d-pt', { hasText: '4/4' })).toHaveCount(0)
  })

  test('hand cards show mana-cost pips', async ({ page }) => {
    await gotoScreen(page, 'game')
    // mana cost shows on each hand-fan card: Counterspell {U}{U}, Lightning Bolt {R}
    await expect(page.locator('.hand-card-cost .mana-pip').first()).toBeVisible()
    await expect(page.locator('.hand-card-cost .mana-pip', { hasText: 'U' }).first()).toBeVisible()
  })

  test('hovering a card shows a large readable preview (name, type, P/T)', async ({ page }) => {
    await gotoScreen(page, 'game')
    // no preview until hover
    await expect(page.locator('.card-preview')).toHaveCount(0)
    // hover the Serra Angel chip in the playable bar (a 4/4 creature)
    await page.locator('.play-chip', { hasText: 'Serra Angel' }).hover()
    const preview = page.locator('.card-preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('.card-preview-name')).toHaveText('Serra Angel')
    await expect(preview.locator('.card-preview-pt')).toHaveText('4/4')
    // moving away hides it
    await page.locator('.playable-label').hover()
    await expect(page.locator('.card-preview')).toHaveCount(0)
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
})
