import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Deck import / upload', () => {
  test('paste text imports a deck and shows unresolved cards', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'Deck Editor' }).click()
    await page.getByRole('button', { name: 'Import' }).click()
    await page.locator('.import-textarea').fill('4 Lightning Bolt')
    // the modal's own Import (submit) button
    await page.locator('.modal').getByRole('button', { name: 'Import' }).click()
    await expect(page.locator('.deck-entry', { hasText: 'Lightning Bolt' })).toContainText('4×')
    await expect(page.getByText(/Not found: Fake Card/)).toBeVisible()
  })

  test('uploading a .dck reports the stored name and loads it', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'Deck Editor' }).click()
    await page.locator('input[type=file]').setInputFiles({
      name: 'mydeck.dck',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('1 [M21:1] Lightning Bolt\n'),
    })
    await expect(page.getByText(/Uploaded .*Imported Deck/)).toBeVisible()
    // it then loads the returned deck (decks/load is stubbed to Mono Red Aggro)
    await expect(page.getByLabel('Deck name')).toHaveValue('Mono Red Aggro')
  })
})
