import { test, expect } from '@playwright/test'
import { gotoScreen } from './harness'

test.describe('Report a problem', () => {
  test('submits a report and shows the created issue link', async ({ page }) => {
    await gotoScreen(page, 'lobby')

    let posted: { title?: string; context?: { view?: string; userAgent?: string; url?: string } } | null = null
    await page.route('**/api/report', async (route) => {
      posted = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, url: 'https://github.com/jacob-sabella/mage/issues/42', number: 42 }),
      })
    })

    await page.getByRole('button', { name: 'Report problem' }).click()
    await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible()

    const submit = page.getByRole('button', { name: 'Submit report' })
    await expect(submit).toBeDisabled() // explicit action: needs a title

    await page.getByPlaceholder('Short summary').fill('Board does not render')
    await page.getByPlaceholder(/Steps to reproduce/).fill('Joined a game, blank board.')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByText('your report was filed', { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: /issue #42/ })).toHaveAttribute(
      'href',
      'https://github.com/jacob-sabella/mage/issues/42',
    )
    expect(posted!.title).toBe('Board does not render')
    expect(posted!.context!.view).toBe('play')
    expect(posted!.context!.userAgent).toBeTruthy()
  })

  test('request-feature button opens the feature variant and sends kind=feature', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let posted: { kind?: string } | null = null
    await page.route('**/api/report', async (route) => {
      posted = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, url: 'https://github.com/jacob-sabella/mage/issues/7', number: 7 }),
      })
    })
    await page.getByRole('button', { name: 'Request feature' }).click()
    await expect(page.getByRole('heading', { name: 'Request a feature' })).toBeVisible()
    await page.getByPlaceholder('Short summary of the idea').fill('Add a foil shader')
    await page.getByRole('button', { name: 'Submit request' }).click()
    await expect(page.getByText('your request was filed', { exact: false })).toBeVisible()
    expect(posted!.kind).toBe('feature')
  })

  test('shows an error if the gateway has no token configured', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.route('**/api/report', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'problem reporting is not configured on this server' }),
      }),
    )
    await page.getByRole('button', { name: 'Report problem' }).click()
    await page.getByPlaceholder('Short summary').fill('test')
    await page.getByRole('button', { name: 'Submit report' }).click()
    await expect(page.getByText('not configured on this server')).toBeVisible()
  })

  test('screenshot can be removed before submitting', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let posted: { screenshot?: string | null } | null = null
    await page.route('**/api/report', async (route) => {
      posted = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, url: 'https://github.com/jacob-sabella/mage/issues/9', number: 9 }),
      })
    })
    await page.getByRole('button', { name: 'Report problem' }).click()
    // Wait for modal to open (html2canvas capture happens first, can take several seconds)
    await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible()
    // Remove the screenshot if auto-captured; if capture failed there is already no screenshot
    const removeBtn = page.getByRole('button', { name: 'Remove' })
    if (await removeBtn.isVisible()) {
      await removeBtn.click()
    }
    await expect(page.getByText('No screenshot')).toBeVisible()
    await page.getByPlaceholder('Short summary').fill('test remove screenshot')
    await page.getByRole('button', { name: 'Submit report' }).click()
    await expect(page.getByText('your report was filed', { exact: false })).toBeVisible()
    // screenshot should be null or absent when user removed it
    expect(posted!.screenshot ?? null).toBeNull()
  })

  test('user can upload a custom screenshot', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    let posted: { screenshot?: string | null } | null = null
    await page.route('**/api/report', async (route) => {
      posted = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, url: 'https://github.com/jacob-sabella/mage/issues/10', number: 10 }),
      })
    })
    await page.getByRole('button', { name: 'Report problem' }).click()
    // Upload a fake 1x1 PNG via the Upload / Replace button
    const fakeImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    const attachBtn = page.getByRole('button', { name: /Upload|Replace/ })
    await expect(attachBtn).toBeVisible()
    const fileInput = page.locator('.report-screenshot-input')
    await fileInput.setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: fakeImage })
    await expect(page.getByText('Screenshot attached')).toBeVisible()
    await page.getByPlaceholder('Short summary').fill('test upload screenshot')
    await page.getByRole('button', { name: 'Submit report' }).click()
    await expect(page.getByText('your report was filed', { exact: false })).toBeVisible()
    expect(typeof posted!.screenshot).toBe('string')
    expect(posted!.screenshot).toContain('data:image/')
  })

  test('capture-page button is present in the empty-screenshot state', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'Report problem' }).click()
    // Wait for modal to open before checking screenshot state
    await expect(page.getByRole('heading', { name: 'Report a problem' })).toBeVisible()
    // Ensure we are in the no-screenshot state
    const removeBtn = page.getByRole('button', { name: 'Remove' })
    if (await removeBtn.isVisible()) {
      await removeBtn.click()
    }
    await expect(page.getByText('No screenshot')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Capture page' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible()
  })

  test('retake button is present when a screenshot is attached', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('button', { name: 'Report problem' }).click()
    // Upload a screenshot to reach the preview state
    const fakeImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    const fileInput = page.locator('.report-screenshot-input')
    await fileInput.setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: fakeImage })
    await expect(page.getByText('Screenshot attached')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retake' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()
  })
})
