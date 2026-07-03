import { test, expect, type Page } from '@playwright/test'
import { gotoScreen } from './harness'

/* F9 — the 'userRequest' WS frame (server questions with option buttons) and
 * the in-game Rollback affordance (respond action=ROLLBACK_TURNS, data=turns). */

type RespondBody = { kind?: string; value?: string; data?: number }

async function captureResponds(page: Page): Promise<RespondBody[]> {
  const calls: RespondBody[] = []
  await page.route('**/api/game/respond', (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  return calls
}

const emitUserRequest = (page: Page, options: Array<{ label: string; action: string | null }>) =>
  page.evaluate(
    (opts) =>
      (window as unknown as { __emit: (o: unknown) => void }).__emit({
        type: 'userRequest',
        gameId: 'g-1',
        title: 'Rollback request',
        message: 'Computer asks to roll the game back to the start of the turn.',
        relatedUserName: 'Computer',
        options: opts,
      }),
    options,
  )

test('a userRequest frame opens a dialog; picking an option responds with its action', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
  const calls = await captureResponds(page)
  await emitUserRequest(page, [
    { label: 'Deny', action: null },
    { label: 'Allow rollback', action: 'ADD_PERMISSION_TO_ROLLBACK_TURN' },
  ])
  const dialog = page.getByRole('dialog', { name: /Rollback request/ })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Computer asks to roll the game back')
  await dialog.getByRole('button', { name: 'Allow rollback' }).click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(() => calls.find((c) => c.kind === 'action' && c.value === 'ADD_PERMISSION_TO_ROLLBACK_TURN'))
    .toBeTruthy()
})

test('a null-action option only dismisses the dialog (no respond sent)', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
  const calls = await captureResponds(page)
  await emitUserRequest(page, [
    { label: 'Deny', action: null },
    { label: 'Allow rollback', action: 'ADD_PERMISSION_TO_ROLLBACK_TURN' },
  ])
  const dialog = page.getByRole('dialog', { name: /Rollback request/ })
  await dialog.getByRole('button', { name: 'Deny' }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(250)
  expect(calls.filter((c) => c.kind === 'action')).toEqual([])
})

test('the Rollback affordance sends ROLLBACK_TURNS with the turn count as data', async ({ page }) => {
  await gotoScreen(page, 'game')
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
  const calls = await captureResponds(page)

  await page.getByRole('button', { name: /Rollback/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Rollback turns' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Restart this turn' }).click()
  await expect
    .poll(() => calls.find((c) => c.kind === 'action' && c.value === 'ROLLBACK_TURNS'))
    .toBeTruthy()
  expect(calls.find((c) => c.value === 'ROLLBACK_TURNS')!.data).toBe(0)

  await page.getByRole('button', { name: /Rollback/ }).click()
  await page.getByRole('dialog', { name: 'Rollback turns' }).getByRole('button', { name: 'Back one turn' }).click()
  await expect
    .poll(() => calls.filter((c) => c.value === 'ROLLBACK_TURNS').length)
    .toBe(2)
  expect(calls.filter((c) => c.value === 'ROLLBACK_TURNS')[1].data).toBe(1)
})
