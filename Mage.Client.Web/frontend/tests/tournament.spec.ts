import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

/* Tournament spectating: 🏆 Watch on a tournament table opens the standings/
 * pairings panel; a running pairing's Watch spectates its sub-table duel. */

test('tournament table shows 🏆 Watch; the panel lists standings and pairings', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  const row = page.getByRole('row', { name: /Friday Draft/ })
  const watched: string[] = []
  await page.route('**/api/tournament/watch', (route) => {
    watched.push(JSON.parse(route.request().postData() || '{}').tableId)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await row.getByRole('button', { name: /Watch/ }).click()
  await expect.poll(() => watched).toContain('t3')
  // the gateway answers with a showTournament frame → the panel opens
  await page.evaluate(() => (window as unknown as { __emit: (o: unknown) => void }).__emit({ type: 'showTournament', tournamentId: 'trn-1' }))
  const modal = page.locator('.tournament-modal')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('cell', { name: 'Urza' })).toBeVisible()
  await expect(modal.locator('.tournament-pairing')).toContainText('Urza - Mishra')
})

test('watching a pairing spectates its sub-table', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  await page.waitForFunction(() => typeof (window as unknown as { __emit?: unknown }).__emit === 'function')
  const tables: string[] = []
  await page.route('**/api/watch-table', (route) => {
    tables.push(JSON.parse(route.request().postData() || '{}').tableId)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.evaluate(() => (window as unknown as { __emit: (o: unknown) => void }).__emit({ type: 'showTournament', tournamentId: 'trn-1' }))
  await page.locator('.tournament-pairing').getByRole('button', { name: 'Watch' }).click()
  await expect.poll(() => tables).toContain('sub-t1')
  // modal closed, board view engaged (connecting state until frames arrive)
  await expect(page.locator('.tournament-modal')).toHaveCount(0)
})
