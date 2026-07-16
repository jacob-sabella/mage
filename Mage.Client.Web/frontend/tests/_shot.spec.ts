import { test } from '@playwright/test'
import { gotoScreen } from './harness'

test.use({ viewport: { width: 1440, height: 860 } })

const DRAFT = {
  name: '2004 GW Astral Slide',
  format: 'constructed',
  commander: null,
  boards: {
    main: [
      { name: 'Eternal Dragon', count: 4, manaValue: 7, colors: 'W', types: ['Creature'], manaCost: '{5}{W}{W}' },
      { name: 'Exalted Angel', count: 4, manaValue: 6, colors: 'W', types: ['Creature'], manaCost: '{4}{W}{W}' },
      { name: 'Wirewood Elf', count: 4, manaValue: 1, colors: 'G', types: ['Creature'], manaCost: '{G}' },
      { name: 'Krosan Tusker', count: 3, manaValue: 7, colors: 'G', types: ['Creature'], manaCost: '{5}{G}{G}' },
      { name: 'Astral Slide', count: 4, manaValue: 3, colors: 'W', types: ['Enchantment'], manaCost: '{2}{W}' },
      { name: 'Lightning Rift', count: 2, manaValue: 2, colors: 'R', types: ['Enchantment'], manaCost: '{1}{R}' },
      { name: 'Renewed Faith', count: 4, manaValue: 3, colors: 'W', types: ['Instant'], manaCost: '{2}{W}' },
      { name: 'Slice and Dice', count: 3, manaValue: 6, colors: 'R', types: ['Sorcery'], manaCost: '{4}{R}{R}' },
      { name: 'Wrath of God', count: 4, manaValue: 4, colors: 'W', types: ['Sorcery'], manaCost: '{2}{W}{W}' },
      { name: 'Plains', count: 14, manaValue: 0, colors: '', types: ['Basic', 'Land'], manaCost: '' },
      { name: 'Forest', count: 11, manaValue: 0, colors: '', types: ['Basic', 'Land'], manaCost: '' },
    ],
    side: [
      { name: 'Circle of Protection: Red', count: 3, manaValue: 2, colors: 'W', types: ['Enchantment'], manaCost: '{1}{W}' },
    ],
    maybe: [],
  },
}

test('deck builder shots', async ({ page }) => {
  const errs: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  await page.addInitScript((draft) => {
    localStorage.setItem('mage.deckbuilder.draft', JSON.stringify(draft))
  }, DRAFT)
  await gotoScreen(page, 'lobby')
  await page.getByRole('button', { name: 'Deck Editor' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/builder.png' })
  // focused board row via keyboard
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/builder-focus.png' })
  // curve filter
  await page.locator('.sl-curve-col').nth(3).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/builder-filter.png' })
  await page.keyboard.press('Escape')
  // omnibox
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/builder-omni.png' })
  await page.keyboard.press('Escape')
  // commander mode
  await page.locator('.sl-top select').first().selectOption('commander')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/builder-commander.png' })
  // eslint-disable-next-line no-console
  console.log('ERRS', JSON.stringify(errs.slice(0, 6)))
})
