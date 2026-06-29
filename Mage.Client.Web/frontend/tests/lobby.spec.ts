import { test, expect } from '@playwright/test'
import { gotoScreen, SAMPLE } from './harness'

test.describe('Lobby', () => {
  test('resumes a session and lists open tables', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
    for (const t of SAMPLE.tables) {
      await expect(page.getByText(t.name, { exact: true })).toBeVisible()
    }
  })

  test('Join shows only on joinable tables; Watch on running games', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    // Waiting 1/2 table -> Join; Dueling 2/2 table -> Watch, no Join
    const waiting = page.getByRole('row', { name: /Aggro Duel/ })
    const dueling = page.getByRole('row', { name: /Live Duel/ })
    await expect(waiting.getByRole('button', { name: 'Join' })).toBeVisible()
    await expect(dueling.getByRole('button', { name: 'Watch' })).toBeVisible()
    await expect(dueling.getByRole('button', { name: 'Join' })).toHaveCount(0)
  })

  test('New game opens the table setup screen', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'New game', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible()
    await expect(page.locator('.table-setup')).toBeVisible()
  })

  test('History shows finished matches', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByRole('heading', { name: 'Match history' })).toBeVisible()
    await expect(page.getByText('You [1-0], Computer [0-1]')).toBeVisible()
  })
})
