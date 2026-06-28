import { test, expect, type Page, type Locator } from '@playwright/test'
import { gotoScreen } from './harness'

// Responsive layout / usability audit across a matrix of resolutions and aspect
// ratios. For each screen at each viewport it asserts:
//   1. no horizontal overflow (nothing spills off the side / is cut off)
//   2. primary controls are a comfortable tap size and not covered by anything
//      (so every button you need is actually usable)
// Heavy (viewports × screens), so it's opt-in: `npm run test:audit` (AUDIT=1).
// It also logs softer warnings (small/covered secondary controls) for review.

const AUDIT = !!process.env.AUDIT

const VIEWPORTS = [
  { name: 'galaxy-fold', w: 280, h: 653 },
  { name: 'iphone-se1', w: 320, h: 568 },
  { name: 'small-android', w: 360, h: 640 },
  { name: 'iphone-se', w: 375, h: 667 },
  { name: 'iphone-14', w: 390, h: 844 },
  { name: 'pixel-7', w: 412, h: 915 },
  { name: 'mobile-landscape', w: 844, h: 390 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'ipad-landscape', w: 1024, h: 768 },
  { name: 'laptop', w: 1366, h: 768 },
  { name: 'desktop', w: 1920, h: 1080 },
  { name: 'ultrawide', w: 2560, h: 1080 },
]

type Screen = { name: string; go: (p: Page) => Promise<void>; controls: (p: Page) => { label: string; loc: Locator }[] }

const SCREENS: Screen[] = [
  {
    name: 'login',
    go: async (p) => {
      await p.goto('/')
      await p.waitForTimeout(700)
    },
    controls: (p) => [
      { label: 'Connect', loc: p.getByRole('button', { name: /Connect/ }) },
      { label: 'server preset', loc: p.locator('.server-chip').first() },
    ],
  },
  {
    name: 'lobby',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
    },
    controls: (p) => [
      { label: 'nav Play', loc: p.getByRole('button', { name: 'Play', exact: true }) },
      { label: 'nav Deck Editor', loc: p.getByRole('button', { name: 'Deck Editor' }) },
      { label: 'nav Settings', loc: p.getByRole('button', { name: 'Settings' }) },
    ],
  },
  {
    name: 'deck',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('button', { name: 'Deck Editor' }).click()
      await p.waitForTimeout(600)
    },
    controls: (p) => [
      { label: 'Search', loc: p.getByRole('button', { name: 'Search', exact: true }) },
      { label: 'Import', loc: p.getByRole('button', { name: 'Import' }) },
      { label: 'first card tile', loc: p.locator('.card-tile-art').first() },
    ],
  },
  {
    name: 'game',
    go: async (p) => {
      await gotoScreen(p, 'game')
      await p.waitForTimeout(900)
    },
    controls: (p) => [
      { label: 'Pass', loc: p.getByRole('button', { name: /^Pass/ }) },
      { label: 'Done', loc: p.getByRole('button', { name: /^Done/ }) },
      { label: 'playable chip', loc: p.locator('.play-chip').first() },
      { label: 'view-fab', loc: p.locator('.view-fab') },
    ],
  },
]

/** Check a control is a comfortable tap size and (when on-screen) not covered. */
async function checkControl(page: Page, loc: Locator, label: string, mobile: boolean): Promise<string[]> {
  const errs: string[] = []
  if ((await loc.count()) === 0) return [`${label}: missing`]
  const el = loc.first()
  if (!(await el.isVisible())) return [`${label}: hidden`]
  const box = await el.boundingBox()
  if (!box) return [`${label}: no box`]
  const minH = mobile ? 30 : 24
  const minW = 24
  if (box.height < minH) errs.push(`${label}: short ${Math.round(box.height)}px`)
  if (box.width < minW) errs.push(`${label}: narrow ${Math.round(box.width)}px`)
  const vp = page.viewportSize()!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  // only hit-test controls actually within the viewport (off-screen = scrollable, fine)
  if (cx >= 0 && cy >= 0 && cx <= vp.width && cy <= vp.height) {
    const hit = await el.evaluate(
      (node, [x, y]) => {
        const e = document.elementFromPoint(x as number, y as number)
        return { ok: !!e && (e === node || node.contains(e)), tag: e ? `${e.tagName}.${(e.className || '').toString().split(' ')[0]}` : 'none' }
      },
      [cx, cy],
    )
    if (!hit.ok) errs.push(`${label}: covered by ${hit.tag}`)
  }
  return errs
}

;(AUDIT ? test.describe : test.describe.skip)('layout audit', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } })
      const mobile = vp.w <= 760
      for (const screen of SCREENS) {
        test(`${screen.name}`, async ({ page }) => {
          await screen.go(page)
          // 1. no horizontal overflow
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          )
          expect(overflow, `horizontal overflow ${overflow}px`).toBeLessThanOrEqual(2)
          // 2. primary controls usable
          const errs: string[] = []
          for (const c of screen.controls(page)) errs.push(...(await checkControl(page, c.loc, c.label, mobile)))
          expect(errs, errs.join(' | ')).toEqual([])
        })
      }
    })
  }
})

test('layout audit is opt-in (AUDIT=1)', () => {
  test.skip(!AUDIT, 'run with AUDIT=1 (npm run test:audit)')
})
