import { test, expect, type Page } from '@playwright/test'
import { gotoScreen, SAMPLE } from './harness'

/* Between-games sideboarding (the 'sideboard' WS frame): the editor must take
 * over IMMEDIATELY (even over the game-over overlay — the window is timed),
 * support click-to-swap between main/side, autosave every edit, and submit
 * main + sideboard through /api/draft/submit. */

const waitEmit = (page: Page) =>
  page.waitForFunction(() => typeof (window as unknown as { __emit?: unknown }).__emit === 'function')

function emitSideboard(page: Page, overrides: Record<string, unknown> = {}) {
  const frame = {
    type: 'sideboard',
    tableId: 't-match',
    main: SAMPLE.sideboard.main,
    side: SAMPLE.sideboard.side,
    time: 180,
    limited: false,
    ...overrides,
  }
  return page.evaluate((f) => (window as unknown as { __emit: (o: unknown) => void }).__emit(f), frame)
}

test('sideboard frame surfaces the editor even over the game-over overlay', async ({ page }) => {
  await gotoScreen(page, 'gameOver')
  await expect(page.locator('.game-over-overlay')).toBeVisible()
  await emitSideboard(page)
  // the sideboard screen replaces the finished game + its overlay at once
  await expect(page.getByRole('heading', { name: 'Sideboarding' })).toBeVisible()
  await expect(page.locator('.game-over-overlay')).toHaveCount(0)
  // both zones render with live counts and the countdown is up
  await expect(page.locator('.chip', { hasText: 'main 3' })).toBeVisible()
  await expect(page.locator('.chip', { hasText: 'side 2' })).toBeVisible()
  await expect(page.locator('.sb-timer')).toContainText('3:00')
})

test('click-to-swap moves cards between zones, updates counts, and autosaves', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await waitEmit(page)
  const updates: Array<{ cards: { name: string; qty: number }[]; sideboard: { name: string }[] }> = []
  await page.route('**/api/deck/update', (route) => {
    updates.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await emitSideboard(page, { time: null })
  await expect(page.getByRole('heading', { name: 'Sideboarding' })).toBeVisible()
  await expect(page.locator('.sb-timer')).toHaveCount(0) // untimed → no clock

  const mainZone = page.locator('.sb-zone-main')
  const sideZone = page.locator('.sb-zone-side')
  await expect(mainZone.locator('.sb-card')).toHaveCount(3)
  await expect(sideZone.locator('.sb-card')).toHaveCount(2)

  // main → side
  await mainZone.locator('.sb-card', { hasText: 'Lightning Bolt' }).click()
  await expect(page.locator('.chip', { hasText: 'main 2' })).toBeVisible()
  await expect(page.locator('.chip', { hasText: 'side 3' })).toBeVisible()
  await expect(sideZone.locator('.sb-card', { hasText: 'Lightning Bolt' })).toBeVisible()

  // the edit autosaves (debounced 500ms) with the submit-shaped card lists
  await expect.poll(() => updates.length, { timeout: 5000 }).toBeGreaterThan(0)
  const last = updates[updates.length - 1]
  expect(last.sideboard.map((c) => c.name)).toContain('Lightning Bolt')
  expect(last.cards.map((c) => c.name)).not.toContain('Lightning Bolt')

  // side → main brings it back
  await sideZone.locator('.sb-card', { hasText: 'Lightning Bolt' }).click()
  await expect(page.locator('.chip', { hasText: 'main 3' })).toBeVisible()
})

test('submit sends main + sideboard (same {name,set,num,qty} encoding)', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await waitEmit(page)
  let body: {
    tableId?: string
    cards?: { name: string; qty: number }[]
    sideboard?: { name: string; qty: number }[]
  } = {}
  await page.route('**/api/draft/submit', (route) => {
    body = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await emitSideboard(page)
  await page.locator('.sb-zone-main .sb-card', { hasText: 'Goblin Guide' }).click() // move one out
  await page.getByRole('button', { name: 'Submit deck' }).click()
  await expect.poll(() => body.tableId).toBe('t-match')
  expect(body.cards!.map((c) => c.name).sort()).toEqual(['Lightning Bolt', 'Mountain'])
  expect(body.sideboard!.map((c) => c.name)).toContain('Goblin Guide')
  expect(body.sideboard!.every((c) => typeof c.qty === 'number')).toBe(true)
  await expect(page.getByText(/Deck submitted/)).toBeVisible()
})

test('constructed decks warn (not block) under 60 cards; limited gets basics + a 40 floor', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await waitEmit(page)
  await emitSideboard(page) // 3-card constructed main
  await expect(page.locator('.sb-warning')).toContainText('at least 60')
  await expect(page.getByRole('button', { name: 'Submit deck' })).toBeEnabled()
  // constructed sideboarding has NO basic-land steppers
  await expect(page.locator('.construct-basics')).toHaveCount(0)

  // a limited frame re-mounts with basics steppers and the 40-card floor
  await emitSideboard(page, { limited: true })
  await expect(page.locator('.construct-basics')).toBeVisible()
  await expect(page.locator('.sb-warning')).toContainText('at least 40')
})

test('countdown ticks down and turns urgent under 30s', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await waitEmit(page)
  await emitSideboard(page, { time: 180 })
  const timer = page.locator('.sb-timer')
  await expect(timer).toContainText('3:00')
  await expect(timer).toContainText('2:5') // ticked into 2:5x
  await expect(timer).not.toHaveClass(/urgent/)
  await emitSideboard(page, { time: 20 })
  await expect(page.locator('.sb-timer')).toHaveClass(/urgent/)
})
