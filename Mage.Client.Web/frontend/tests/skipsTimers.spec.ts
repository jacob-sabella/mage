import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

/* Legacy-parity skip controls (F3–F11 key map) + per-player match clock. */

test('skip bar shows the legacy skip set; the armed skip is lit; Cancel appears only when armed', async ({ page }) => {
  await gotoScreen(page, 'game')
  for (const label of ['Turn', 'End step', 'Main', 'Resolve', 'My turn', 'Pre-turn']) {
    await expect(page.locator('.skip-btn', { hasText: label }).first()).toBeVisible()
  }
  // harness arms PASS_PRIORITY_UNTIL_STACK_RESOLVED on the viewer
  await expect(page.locator('.skip-btn.armed')).toHaveCount(1)
  await expect(page.locator('.skip-btn.armed')).toContainText('Resolve')
  // something is armed → the F3 cancel button is offered
  await expect(page.locator('.skip-btn', { hasText: 'Cancel' })).toBeVisible()
})

test('F5 / F9 fire their legacy skip actions', async ({ page }) => {
  await gotoScreen(page, 'game')
  await page.locator('.turn-label').click()
  const actions: string[] = []
  await page.route('**/api/game/respond', (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    if (b.kind === 'action') actions.push(b.value)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.keyboard.press('F5')
  await expect.poll(() => actions).toContain('PASS_PRIORITY_UNTIL_TURN_END_STEP')
  await page.keyboard.press('F9')
  await expect.poll(() => actions).toContain('PASS_PRIORITY_UNTIL_MY_NEXT_TURN')
})

test('match clock renders m:ss per player and ticks while running', async ({ page }) => {
  await gotoScreen(page, 'game')
  const clocks = page.locator('.pstat-clock')
  await expect(clocks).toHaveCount(2) // both harness players have timeLeft
  await expect(clocks.filter({ hasText: '19:40' })).toHaveCount(1) // 1180s, not running
  // the running clock (1421s = 23:41) ticks down locally between pushes
  const running = page.locator('.pstat-clock.running')
  await expect(running).toHaveCount(1)
  const before = await running.textContent()
  await expect.poll(async () => running.textContent(), { timeout: 4000 }).not.toBe(before)
})

test('clicking your own mana pip sends a mana payment respond', async ({ page }) => {
  await gotoScreen(page, 'game') // harness: You holds a select prompt + {U}{U}{R} pool
  const sent: string[] = []
  await page.route('**/api/game/respond', (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    if (b.kind === 'mana') sent.push(b.value)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.locator('button.mana-pip-pay').first().click()
  await expect.poll(() => sent).toContain('BLUE:me')
})
