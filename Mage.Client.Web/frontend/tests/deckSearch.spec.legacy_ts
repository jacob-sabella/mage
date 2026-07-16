import { test, expect, type Page } from '@playwright/test'
import { gotoScreen } from './harness'

async function openEditor(page: Page) {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.locator('.deck-editor')).toBeVisible()
}

// the search endpoint request whose q param equals `q` (decoded)
const searchWith = (page: Page, q: string) =>
  page.waitForRequest((r) => r.url().includes('/api/cards/search') && new URL(r.url()).searchParams.get('q') === q)

test('the search box passes the raw query syntax through as ?q verbatim', async ({ page }) => {
  await openEditor(page)
  const req = searchWith(page, 't:creature o:"draw a card"')
  await page.locator('.deck-search-bar input').fill('t:creature o:"draw a card"')
  await req // debounced live search fired with the exact syntax (not mangled)
})

test('a quick-search chip fills the box and runs that search', async ({ page }) => {
  await openEditor(page)
  const req = searchWith(page, 't:creature')
  await page.locator('.deck-chip', { hasText: 'Creatures' }).click()
  await expect(page.locator('.deck-search-bar input')).toHaveValue('t:creature')
  await req
})

test('the ? popover lists the grammar and its examples are click-to-run', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Search syntax help' }).click()
  const help = page.locator('.deck-syntax-help')
  await expect(help).toBeVisible()
  await expect(help.locator('.deck-syntax-token', { hasText: 'o:' })).toBeVisible()
  const req = searchWith(page, 'o:"draw a card"')
  await help.locator('.deck-syntax-eg', { hasText: 'draw a card' }).click()
  await expect(page.locator('.deck-search-bar input')).toHaveValue('o:"draw a card"')
  await expect(help).toHaveCount(0) // closes after picking an example
  await req
})
