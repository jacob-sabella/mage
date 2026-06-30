import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('quick-chat buttons send a preset phrase', async ({ page }) => {
  await gotoScreen(page, 'lobby')
  let sent: string | null = null
  await page.route('**/api/chat', (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    sent = b.message ?? null
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.getByRole('button', { name: 'Good game!' }).click()
  await expect.poll(() => sent).toBe('Good game!')
})
