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

    // snap-view controls
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible()
  })

  test('priority prompt offers Pass and Done; skip bar + log present', async ({ page }) => {
    await gotoScreen(page, 'game')
    await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Next turn/ })).toBeVisible()
    await expect(page.locator('.game-log')).toBeVisible()
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

  test('mulligan prompt offers Yes/No', async ({ page }) => {
    await gotoScreen(page, 'mulligan')
    await expect(page.getByText(/Mulligan/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'No' })).toBeVisible()
  })

  test('target prompt shows the choose-a-target hint', async ({ page }) => {
    await gotoScreen(page, 'target')
    await expect(page.getByText('Choose a target', { exact: false })).toBeVisible()
  })

  test('snap-view buttons switch the active view', async ({ page }) => {
    await gotoScreen(page, 'game')
    const overview = page.getByRole('button', { name: 'Overview' })
    await overview.click()
    await expect(overview).toHaveClass(/active/)
  })
})
