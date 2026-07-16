import { test, expect, type Page } from '@playwright/test'
import { gotoScreen } from './harness'

async function openBuilder(page: Page) {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.getByTestId('deck-builder')).toBeVisible()
}

const row = (page: Page, name: string) => page.locator('.sl-row', { hasText: name })
const result = (page: Page, name: string) => page.locator('.sl-result', { hasText: name })

test('search result adds to the maindeck; pips set and toggle counts', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(row(page, 'Lightning Bolt')).toBeVisible()
  // click pip 4 → count 4
  await row(page, 'Lightning Bolt').getByRole('button', { name: 'Set Lightning Bolt to 4' }).click()
  await expect(page.locator('.sl-tab.active .n')).toHaveText('4')
  // click top filled pip (4) again → decrement to 3
  await row(page, 'Lightning Bolt').getByRole('button', { name: 'Remove a copy of Lightning Bolt' }).click()
  await expect(page.locator('.sl-tab.active .n')).toHaveText('3')
})

test('shift-click adds a playset', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Serra Angel').getByRole('button', { name: 'Add Serra Angel' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.sl-tab.active .n')).toHaveText('4')
})

test('keyboard: Enter adds, Tab focuses board, digit sets count, 0 cuts, ⌘Z undoes', async ({ page }) => {
  await openBuilder(page)
  await page.locator('.sl-result').first().click() // focus a search row
  await page.keyboard.press('Enter')
  await expect(page.locator('.sl-tab.active .n')).toHaveText('1')
  await page.keyboard.press('Tab') // → board zone
  await page.keyboard.press('3') // set count 3
  await expect(page.locator('.sl-tab.active .n')).toHaveText('3')
  await page.keyboard.press('0') // cut
  await expect(page.locator('.sl-tab.active .n')).toHaveText('0')
  await page.keyboard.press('Control+z') // undo the cut
  await expect(page.locator('.sl-tab.active .n')).toHaveText('3')
})

test('undo chip names the last action and reverts it', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click()
  const chip = page.locator('.sl-undo-chip')
  await expect(chip).toContainText('+1 Lightning Bolt')
  await chip.click()
  await expect(page.locator('.sl-tab.active .n')).toHaveText('0')
})

test('s moves a copy to the sideboard; side tab shows it', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Counterspell').getByRole('button', { name: 'Add Counterspell' }).click()
  await row(page, 'Counterspell').click()
  await page.keyboard.press('s')
  await page.locator('.sl-tab', { hasText: 'Sideboard' }).click()
  await expect(row(page, 'Counterspell')).toBeVisible()
})

test('commander format: singleton pips and the command zone via C', async ({ page }) => {
  await openBuilder(page)
  await page.getByTestId('deck-builder').getByLabel('Format').selectOption('commander')
  await expect(page.locator('.sl-commander')).toContainText('No commander')
  await result(page, 'Serra Angel').click()
  await page.keyboard.press('c')
  await expect(page.locator('.sl-commander')).toContainText('Serra Angel')
  // singleton: adds cap at 1
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.sl-tab.active .n')).toHaveText('1')
})

test('curve bar filters the board and Esc clears', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Serra Angel').getByRole('button', { name: 'Add Serra Angel' }).click() // mv 5
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click() // mv 1
  await page.locator('.sl-curve-col').nth(5).click()
  await expect(row(page, 'Serra Angel')).toBeVisible()
  await expect(row(page, 'Lightning Bolt')).toHaveCount(0)
  await expect(page.locator('.sl-filter-tag')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(row(page, 'Lightning Bolt')).toBeVisible()
})

test('import dialog replaces the deck (undoably)', async ({ page }) => {
  await openBuilder(page)
  await page.getByRole('button', { name: 'Import' }).click()
  await page.locator('.sl-dialog textarea').fill('4 Lightning Bolt\n20 Mountain')
  await page.locator('.sl-dialog').getByRole('button', { name: 'Import' }).click()
  await expect(page.locator('.sl-deckname')).toHaveValue('Imported deck')
  await expect(page.locator('.sl-row').first()).toBeVisible()
})

test('paste a decklist anywhere imports it', async ({ page }) => {
  await openBuilder(page)
  await page.getByTestId('deck-builder').click({ position: { x: 600, y: 300 } })
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', '4 Lightning Bolt\n4 Counterspell\n20 Island')
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
  })
  await expect(page.locator('.sl-deckname')).toHaveValue('Imported deck')
})

test('omnibox burst-add stays open between adds', async ({ page }) => {
  await openBuilder(page)
  await page.keyboard.press('Control+k')
  const omni = page.locator('.sl-omni input')
  await expect(omni).toBeFocused()
  await omni.fill('bolt')
  await expect(page.locator('.sl-omni-row').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(omni).toHaveValue('') // cleared, still open
  await expect(page.locator('.sl-omni-hint')).toContainText('Lightning Bolt')
  await page.keyboard.press('Escape')
  await expect(page.locator('.sl-tab.active .n')).toHaveText('1')
})

test('basics button is reachable on an empty deck and sets land counts', async ({ page }) => {
  await openBuilder(page)
  await page.getByRole('button', { name: 'Basics ▾' }).click()
  await page.getByRole('button', { name: 'More Mountain' }).click()
  await page.getByRole('button', { name: 'More Mountain' }).click()
  await expect(row(page, 'Mountain').locator('.sl-count-num')).toHaveText('2')
})

test('goldfish deals a 7-card hand', async ({ page }) => {
  await openBuilder(page)
  // 8 cards via playsets → full 7-card hand
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] })
  await result(page, 'Counterspell').getByRole('button', { name: 'Add Counterspell' }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Goldfish' }).click()
  await expect(page.locator('.sl-hand img')).toHaveCount(7)
})

test('draft persists across a reload', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Serra Angel').getByRole('button', { name: 'Add Serra Angel' }).click({ modifiers: ['Shift'] })
  await page.reload()
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(row(page, 'Serra Angel')).toBeVisible()
  await expect(page.locator('.sl-tab.active .n')).toHaveText('4')
})

// ---- regression tests for the adversarial-review findings ----

test('no infinite render loop on mount or when focusing an empty board', async ({ page }) => {
  const errs: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await openBuilder(page)
  // focus the (empty) Maybe board — the clamp path with max = -1
  await page.locator('.sl-tab', { hasText: 'Maybe' }).click()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)
  // still responsive; a runaway setState loop would spam this specific error
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.locator('.sl-dialog')).toBeVisible()
  expect(errs.join('\n')).not.toContain('Maximum update depth exceeded')
})

test('Tab still moves native focus between toolbar buttons (not hijacked)', async ({ page }) => {
  await openBuilder(page)
  await page.getByRole('button', { name: 'Import' }).focus()
  await page.keyboard.press('Tab')
  const tag = await page.evaluate(() => document.activeElement?.tagName)
  expect(tag).toBe('BUTTON') // focus advanced to another control, not swallowed
})

test('Escape closes the Import dialog', async ({ page }) => {
  await openBuilder(page)
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.locator('.sl-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.sl-dialog')).toHaveCount(0)
})

test('switching format away from Commander returns the commander to the maindeck', async ({ page }) => {
  await openBuilder(page)
  await page.getByTestId('deck-builder').getByLabel('Format').selectOption('commander')
  await result(page, 'Serra Angel').click()
  await page.keyboard.press('c')
  await expect(page.locator('.sl-commander')).toContainText('Serra Angel')
  await page.getByTestId('deck-builder').getByLabel('Format').selectOption('constructed')
  // no phantom: Serra Angel is now a visible maindeck row, command zone gone
  await expect(page.locator('.sl-commander')).toHaveCount(0)
  await expect(row(page, 'Serra Angel')).toBeVisible()
})

test('Snow-Covered basics use the numeric stepper and keep >4 copies', async ({ page }) => {
  await openBuilder(page)
  // the backend never sends the Basic supertype, so snow basics arrive as plain LANDs
  await page.route('**/api/decks/import', async (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      name: 'Snow', unresolved: [], sideboard: [],
      cards: [{ name: 'Snow-Covered Island', count: 20, manaValue: 0, colors: '', types: ['LAND'], manaCost: '' }],
    }) }),
  )
  await page.getByRole('button', { name: 'Import' }).click()
  await page.locator('.sl-dialog textarea').fill('20 Snow-Covered Island')
  await page.locator('.sl-dialog').getByRole('button', { name: 'Import' }).click()
  const r = row(page, 'Snow-Covered Island')
  await expect(r.locator('.sl-count-num')).toHaveText('20') // numeric stepper, not pips
  await r.getByRole('button', { name: 'Add one Snow-Covered Island' }).click()
  await expect(r.locator('.sl-count-num')).toHaveText('21') // not clamped to 4
})

test('save sends the sideboard to the server', async ({ page }) => {
  await openBuilder(page)
  let savedBody: any = null
  await page.route('**/api/decks/save', async (route) => {
    savedBody = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path: '/decks/out.dck' }) })
  })
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await result(page, 'Counterspell').getByRole('button', { name: 'Add Counterspell' }).click()
  await row(page, 'Counterspell').click()
  await page.keyboard.press('s') // → sideboard
  await page.getByRole('button', { name: /^Save/ }).click()
  await expect.poll(() => savedBody?.sideboard).toContain('Counterspell')
  expect(savedBody.cards).toContain('Lightning Bolt')
})

test('deck-name typing collapses to a single undo step', async ({ page }) => {
  await openBuilder(page)
  await result(page, 'Lightning Bolt').getByRole('button', { name: 'Add Lightning Bolt' }).click()
  const name = page.locator('.sl-deckname')
  await name.fill('')
  await name.pressSequentially('Mono Red', { delay: 15 })
  await expect(name).toHaveValue('Mono Red')
  await page.keyboard.press('Escape') // blur the name field (deck-undo is gated while typing)
  // one undo reverts the whole rename (not one character), and crucially does
  // NOT evict the Lightning Bolt add from history
  await page.keyboard.press('Control+z')
  await expect(name).not.toHaveValue('Mono Red')
  // the add survives — undo it too to prove history wasn't flooded
  await page.keyboard.press('Control+z')
  await expect(page.locator('.sl-tab.active .n')).toHaveText('0')
})
