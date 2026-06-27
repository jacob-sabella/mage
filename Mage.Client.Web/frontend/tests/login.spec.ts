import { test, expect } from '@playwright/test'
import { installMocks } from './harness'

test.describe('Login', () => {
  test('shows the connect screen with server presets', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Connect to a server' })).toBeVisible()
    for (const name of ['Beta', 'USA', 'Europe', 'Local']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible()
  })

  test('a preset fills the server/port fields', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')

    await page.getByRole('button', { name: 'Local', exact: true }).click()
    await expect(page.locator('.field input').first()).toHaveValue('localhost')
  })

  test('connecting lands on the lobby', async ({ page }) => {
    await installMocks(page, 'lobby', { resume: false })
    await page.goto('/')

    await page.getByPlaceholder('Any name (no registration on public servers)').fill('tester')
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible()
  })
})
