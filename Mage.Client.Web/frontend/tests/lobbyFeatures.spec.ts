import { test, expect, type Page } from '@playwright/test'
import { gotoScreen, SAMPLE } from './harness'

/* Lobby feature pack: password tables (🔒 + prompt), tournament join, table
 * filters, the who's-online panel, server messages, and whisper styling. */

const openLobby = async (page: Page) => {
  await gotoScreen(page, 'lobby')
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
}

// ---------------------------------------------------------------------------
// F3 — password-protected tables
// ---------------------------------------------------------------------------
test('password tables show a 🔒 marker; Join prompts and sends the password', async ({ page }) => {
  await openLobby(page)
  const row = page.getByRole('row', { name: /Locked Duel/ })
  await expect(row.locator('.table-lock')).toBeVisible()
  let body: { tableId?: string; deckPath?: string; password?: string } = {}
  await page.route('**/api/join', (route) => {
    body = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await row.getByRole('button', { name: 'Join' }).click()
  // deck first…
  await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
  // …then the password prompt (Esc-cancellable dialog with an input)
  const dialog = page.getByRole('dialog', { name: /Join Locked Duel/ })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Table password').fill('hunter2')
  await dialog.getByRole('button', { name: 'Join' }).click()
  await expect.poll(() => body.tableId).toBe('t4')
  expect(body.deckPath).toBe('/decks/red.dck')
  expect(body.password).toBe('hunter2')
})

test('non-password tables join without any prompt', async ({ page }) => {
  await openLobby(page)
  let body: { tableId?: string; password?: string } = {}
  await page.route('**/api/join', (route) => {
    body = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.getByRole('row', { name: /Aggro Duel/ }).getByRole('button', { name: 'Join' }).click()
  await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
  await expect.poll(() => body.tableId).toBe('t1')
  expect(body.password).toBeUndefined()
})

test('the table-setup advanced options include an optional join password', async ({ page }) => {
  await openLobby(page)
  let body: { password?: string } = {}
  await page.route('**/api/tables/create', (route) => {
    body = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, tableId: 'g-1', started: true, openSeats: 0 }),
    })
  })
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: /Advanced options/ }).click()
  await page.getByPlaceholder('Anyone can join when empty').fill('sekrit')
  await page.getByRole('button', { name: /Mono Red Aggro/ }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect.poll(() => body.password).toBe('sekrit')
})

// ---------------------------------------------------------------------------
// F2 — tournament join
// ---------------------------------------------------------------------------
test('a limited tournament with open seats joins directly (no deck picker)', async ({ page }) => {
  await openLobby(page)
  let body: { tableId?: string; deckPath?: string } = {}
  await page.route('**/api/tournament/join', (route) => {
    body = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.getByRole('row', { name: /Weekly Sealed/ }).getByRole('button', { name: 'Join' }).click()
  await expect.poll(() => body.tableId).toBe('t5')
  expect(body.deckPath).toBeUndefined()
  // no deck picker appeared
  await expect(page.getByRole('heading', { name: /Pick a deck/ })).toHaveCount(0)
})

test('a constructed tournament offers the deck picker with a no-deck fallback', async ({ page }) => {
  await openLobby(page)
  const joins: Array<{ tableId?: string; deckPath?: string }> = []
  await page.route('**/api/tournament/join', (route) => {
    joins.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.getByRole('row', { name: /Modern League/ }).getByRole('button', { name: 'Join' }).click()
  const picker = page.getByRole('heading', { name: /Pick a deck to join with/ })
  await expect(picker).toBeVisible()
  await expect(page.getByRole('button', { name: /No deck \(limited\)/ })).toBeVisible()
  await page.getByRole('button', { name: /Azorius Control/ }).click()
  await expect.poll(() => joins.length).toBe(1)
  expect(joins[0]).toMatchObject({ tableId: 't6', deckPath: '/decks/uw.dck' })
})

// ---------------------------------------------------------------------------
// F6 — table filters
// ---------------------------------------------------------------------------
test('filter chips and the text filter narrow the table list', async ({ page }) => {
  await openLobby(page)
  const rows = page.locator('.data-table tbody tr')
  await expect(rows).toHaveCount(SAMPLE.tables.length)

  await page.getByRole('button', { name: 'Open seats' }).click()
  await expect(rows).toHaveCount(4) // t1, t4, t5, t6 have open seats & aren't running
  await expect(page.getByText('Live Duel', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'In progress' }).click()
  await expect(rows).toHaveCount(2) // t2 + t3 are dueling
  await expect(page.getByText('Live Duel', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Tournaments' }).click()
  await expect(rows).toHaveCount(3) // t3, t5, t6

  await page.getByRole('button', { name: 'All' }).click()
  await page.getByLabel('Filter tables by name or format').fill('sealed')
  await expect(rows).toHaveCount(1)
  await expect(page.getByText('Weekly Sealed', { exact: true })).toBeVisible()

  // an over-narrow filter shows the clear-filters empty state
  await page.getByLabel('Filter tables by name or format').fill('zzz-no-match')
  await expect(page.getByText('No tables match the filter')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(rows).toHaveCount(SAMPLE.tables.length)
})

test('the chosen filter chip persists in prefs', async ({ page }) => {
  await openLobby(page)
  await page.getByRole('button', { name: 'Tournaments' }).click()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mage.prefs') || '{}').lobbyFilter))
    .toBe('tournament')
})

// ---------------------------------------------------------------------------
// F4 — who's online / F5 — server messages
// ---------------------------------------------------------------------------
test('the players-online panel lists users with flag + record, and collapses', async ({ page }) => {
  await openLobby(page)
  const panel = page.locator('.room-users')
  await expect(panel.getByRole('button', { name: /Players online \(2\)/ })).toBeVisible()
  const jaya = panel.locator('.room-user', { hasText: 'Jaya' })
  await expect(jaya).toBeVisible()
  await expect(jaya.locator('.room-user-flag')).toHaveText('us')
  await expect(jaya.locator('.room-user-record')).toHaveText('12-3')
  await panel.getByRole('button', { name: /Players online/ }).click()
  await expect(panel.locator('.room-users-list')).toHaveCount(0)
})

test('server messages show as a dismissible banner above the table list', async ({ page }) => {
  await openLobby(page)
  const banner = page.locator('.server-messages')
  await expect(banner).toContainText('Welcome to the test server!')
  await expect(banner).toContainText('Maintenance window Sunday 03:00 UTC.')
  await banner.getByRole('button', { name: 'Dismiss server messages' }).click()
  await expect(banner).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// F7 — whisper / status chat styling
// ---------------------------------------------------------------------------
test('whispers and status lines get distinct styling in the chat', async ({ page }) => {
  await openLobby(page)
  await page.waitForFunction(() => typeof (window as unknown as { __emit?: unknown }).__emit === 'function')
  await page.evaluate(() => {
    const emit = (window as unknown as { __emit: (o: unknown) => void }).__emit
    emit({ type: 'chat', user: 'Liliana', text: 'psst — trade you a Bolt', messageType: 'WHISPER_FROM', time: Date.now() })
    emit({ type: 'chat', user: null, text: 'Jaya has joined the server', messageType: 'USER_INFO', time: Date.now() })
  })
  const whisper = page.locator('.chat-line.chat-whisper')
  await expect(whisper).toContainText('psst — trade you a Bolt')
  await expect(whisper.locator('.chat-whisper-tag')).toContainText('→ whisper')
  await expect(page.locator('.chat-line.chat-info')).toContainText('Jaya has joined the server')
  // the input hints at the whisper syntax
  await expect(page.getByPlaceholder(/\/w name message/)).toBeVisible()
})
