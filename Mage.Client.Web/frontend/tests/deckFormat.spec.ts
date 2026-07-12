import { test, expect, type Page } from '@playwright/test'
import { gotoScreen } from './harness'

async function openEditor(page: Page) {
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await expect(page.locator('.deck-editor')).toBeVisible()
  await page.locator('.view-switch-btn', { hasText: 'Table' }).click() // easier add buttons
}
const countOf = (page: Page, name: string) =>
  page.locator('.deck-groups .deck-entry', { hasText: name }).locator('.deck-entry-count')

test('the format selector drives the legality target', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  const chip = page.locator('.deck-count-chip')
  await expect(chip).toContainText('/ 60') // constructed default
  await page.getByLabel('Deck format').selectOption('commander')
  await expect(chip).toContainText('/ 100')
  await page.getByLabel('Deck format').selectOption('freeform')
  await expect(chip).toContainText('1 cards') // no minimum → plain count, no target
})

test('constructed tops up to a 4-of and caps there', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] }) // playset
  await expect(countOf(page, 'Lightning Bolt')).toHaveText('4×')
  await page.getByRole('button', { name: 'Increase Lightning Bolt' }).click() // capped at 4
  await expect(countOf(page, 'Lightning Bolt')).toHaveText('4×')
})

test('commander is singleton — a non-basic never exceeds one copy', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('Deck format').selectOption('commander')
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click({ modifiers: ['Shift'] }) // playset request
  await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
  await expect(countOf(page, 'Lightning Bolt')).toHaveText('1×')
})

test('a card moves to the side / command zone and back', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Add Serra Angel' }).click()
  await page.getByRole('button', { name: 'Move Serra Angel to Sideboard' }).click()
  await expect(page.locator('.deck-side-title')).toContainText('Sideboard')
  await expect(page.locator('.deck-groups .deck-entry', { hasText: 'Serra Angel' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Move Serra Angel to maindeck' }).click()
  await expect(page.locator('.deck-groups .deck-entry', { hasText: 'Serra Angel' })).toHaveCount(1)
})
