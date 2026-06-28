import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test('typing "clips" opens the secret test gallery', async ({ page }) => {
  await page.route('**/test-clips/manifest.json', (r) =>
    r.fulfill({ json: { clips: [
      { title: 'sample test one', spec: 'demo.spec.ts', file: 'a.webm', ok: true },
      { title: 'sample test two', spec: 'demo.spec.ts', file: 'b.webm', ok: false },
    ] } }),
  )
  await gotoScreen(page, 'lobby')
  await page.locator('.brand-name').click() // blur the autofocused input
  await page.keyboard.type('clips')
  const dlg = page.getByRole('dialog', { name: 'Test gallery' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('button', { name: /sample test one/ })).toBeVisible()
  await dlg.getByRole('button', { name: /sample test two/ }).click()
  await expect(dlg.locator('.clips-item.active')).toContainText('sample test two')
})
