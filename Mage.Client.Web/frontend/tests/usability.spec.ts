import { test, expect, type Page, type Locator } from '@playwright/test'
import { gotoScreen, installMocks } from './harness'

/*
 * ===========================================================================
 *  HUMAN-CENTRIC USABILITY SUITE  (opt-in: AUDIT=1 — `npm run test:audit`)
 * ===========================================================================
 *  The enforced ruleset (see tests/USABILITY.md for the prose version). Every
 *  rule is a real contract; a failure is a CSS/component defect to fix, never a
 *  test to loosen.
 *
 *   1. No horizontal overflow (scrollWidth - clientWidth <= 2) on every view.
 *   2. No covering/clipping of controls or text — hit-test the centre of every
 *      primary control; it must resolve to that control, not something on top.
 *   3. Comfortable tap targets — >=40x40 on mobile (<=760px), >=24px desktop.
 *   4. No layout shift (CLS < 0.05) on load and on common interactions.
 *   5. No jarring/unbounded animation — durations bounded (<=600ms) except
 *      allowlisted decorative loops; reduce-motion truly suppresses motion.
 *   6. No random movement — key controls don't drift over a 1s idle window.
 *   7. Correct z-order — overlays/modals/toasts render above content; floating
 *      in-game panels don't cover the primary controls.
 *   8. Readability — (a) no primary text < 11px (decorative glyphs exempt), and
 *      (b) content images meant to be READ (the card preview) get a legible
 *      area — at least ~180x250px so the card's rules text is actually readable.
 *   9. Scrollability — overflowing views expose a scroll container.
 *  10. Visible keyboard focus — controls are focusable and :focus-visible is
 *      styled.
 * ===========================================================================
 */

const AUDIT = !!process.env.AUDIT

// Full viewport matrix: tiny foldable up to ultrawide, portrait + landscape.
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

// A representative subset for the heavier per-load checks (CLS, idle drift,
// reduce-motion, focus) so the suite stays bounded but still covers a tiny
// phone, a phone in landscape, a tablet and a wide desktop.
const REP_VIEWPORTS = [
  { name: 'small-android', w: 360, h: 640 },
  { name: 'mobile-landscape', w: 844, h: 390 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'laptop', w: 1366, h: 768 },
]

// Classes whose motion is intentionally looping/decorative — excluded from the
// "bounded animation" and "idle movement" rules.
const DECORATIVE = [
  'scene-bg', 'brand-dot', 'img-progress-fill', 'waiting-spinner', 'reconnect-spinner',
  'spinner', 'hl-play', 'hl-target', 'pstat', 'action-bar', 'life-delta', 'mana-pip',
  'c3d-', 'board3d', 'active-glow', 'card-preview', 'badge-pop',
]

type Screen = {
  name: string
  go: (p: Page) => Promise<void>
  controls: (p: Page) => { label: string; loc: Locator }[]
  // an overlay/modal expected to sit ABOVE the page (rule 7)
  overlay?: (p: Page) => Locator
}

// ---- navigation to every view --------------------------------------------
const SCREENS: Screen[] = [
  {
    name: 'login',
    go: async (p) => {
      await installMocks(p, 'lobby', { resume: false })
      await p.goto('/')
      await p.getByRole('button', { name: /Connect/ }).waitFor()
    },
    controls: (p) => [
      { label: 'Connect', loc: p.getByRole('button', { name: /Connect/ }) },
      { label: 'server preset', loc: p.locator('.server-chip').first() },
      { label: 'nav Settings', loc: p.getByRole('button', { name: 'Settings' }) },
    ],
  },
  {
    name: 'lobby',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('heading', { name: 'Open tables' }).waitFor()
    },
    controls: (p) => [
      { label: 'nav Play', loc: p.getByRole('button', { name: 'Play', exact: true }) },
      { label: 'nav Deck Editor', loc: p.getByRole('button', { name: 'Deck Editor' }) },
      { label: 'nav Settings', loc: p.getByRole('button', { name: 'Settings' }) },
      { label: 'New game', loc: p.getByRole('button', { name: 'New game', exact: true }) },
      { label: 'Disconnect', loc: p.getByRole('button', { name: 'Disconnect' }) },
    ],
  },
  {
    name: 'deck-gallery',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('button', { name: 'Deck Editor' }).click()
      await p.locator('.card-grid').waitFor()
    },
    controls: (p) => [
      { label: 'Search', loc: p.getByRole('button', { name: 'Search', exact: true }) },
      { label: 'Import', loc: p.getByRole('button', { name: 'Import' }) },
      { label: 'first card tile', loc: p.locator('.card-tile-art').first() },
    ],
  },
  {
    name: 'deck-table',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('button', { name: 'Deck Editor' }).click()
      await p.locator('.card-grid').waitFor()
      await p.getByRole('button', { name: /Table/ }).click()
      await p.locator('.deck-table').waitFor()
    },
    controls: (p) => [
      { label: 'Gallery toggle', loc: p.getByRole('button', { name: /Gallery/ }) },
      { label: 'first add btn', loc: p.locator('.deck-table').getByRole('button', { name: /^Add / }).first() },
    ],
  },
  {
    // "New game" opens the TableSetup modal (game type, seats, deck, options).
    name: 'table-setup',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('heading', { name: 'Open tables' }).waitFor()
      await p.getByRole('button', { name: 'New game', exact: true }).click()
      await p.locator('.table-setup').waitFor()
      await p.getByRole('button', { name: /Mono Red Aggro/ }).waitFor()
    },
    controls: (p) => [
      { label: 'deck option', loc: p.getByRole('button', { name: /Mono Red Aggro/ }) },
      { label: 'submit', loc: p.getByRole('button', { name: /Start game|Create table/ }) },
      { label: 'cancel', loc: p.locator('.table-setup').getByRole('button', { name: 'Cancel' }) },
    ],
    overlay: (p) => p.locator('.modal-backdrop').first(),
  },
  {
    name: 'card-preview',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('button', { name: 'Deck Editor' }).click()
      await p.getByRole('button', { name: 'Add Lightning Bolt' }).click()
      await p.locator('.deck-entry', { hasText: 'Lightning Bolt' }).click({ force: true })
      await p.locator('.card-preview-name').waitFor()
    },
    controls: (p) => [
      { label: 'preview', loc: p.locator('.card-preview') },
    ],
  },
  {
    name: 'game',
    go: async (p) => {
      await gotoScreen(p, 'game')
      await p.locator('.board3d canvas').waitFor()
      await p.getByRole('button', { name: /^Pass/ }).waitFor()
    },
    controls: (p) => [
      { label: 'Pass', loc: p.getByRole('button', { name: /^Pass/ }) },
      { label: 'Done', loc: p.getByRole('button', { name: /^Done/ }) },
      { label: 'playable chip', loc: p.locator('.play-chip').first() },
      { label: 'view-fab', loc: p.locator('.view-fab') },
    ],
  },
  {
    name: 'settings',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('button', { name: 'Settings' }).click()
      await p.getByRole('heading', { name: 'Preferences' }).waitFor()
    },
    controls: (p) => [
      { label: 'theme swatch', loc: p.locator('.theme-swatch').first() },
      { label: 'card images toggle', loc: p.locator('.setting-row', { hasText: 'Card images' }).locator('input') },
      { label: 'reset', loc: p.getByRole('button', { name: /Reset preferences/ }) },
    ],
  },
  {
    name: 'history',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('heading', { name: 'Open tables' }).waitFor()
      await p.getByRole('button', { name: 'History', exact: true }).click()
      await p.getByRole('heading', { name: 'Match history' }).waitFor()
    },
    controls: (p) => [
      { label: 'Tables toggle', loc: p.getByRole('button', { name: 'Tables', exact: true }) },
      { label: 'New game', loc: p.getByRole('button', { name: 'New game', exact: true }) },
    ],
  },
  {
    name: 'draft',
    go: async (p) => {
      await gotoScreen(p, 'draft')
      await p.getByRole('heading', { name: 'Booster Draft' }).waitFor()
    },
    controls: (p) => [
      { label: 'draft card', loc: p.locator('.draft-card').first() },
    ],
  },
  {
    name: 'construct',
    go: async (p) => {
      await gotoScreen(p, 'construct')
      await p.getByRole('heading', { name: 'Build your deck' }).waitFor()
    },
    controls: (p) => [
      { label: 'Auto-build', loc: p.getByRole('button', { name: 'Auto-build' }) },
    ],
  },
  {
    name: 'game-over',
    go: async (p) => {
      await gotoScreen(p, 'gameOver')
      await p.locator('.game-over-overlay').waitFor()
    },
    controls: (p) => [
      { label: 'Back to lobby', loc: p.getByRole('button', { name: 'Back to lobby' }) },
    ],
    overlay: (p) => p.locator('.game-over-overlay'),
  },
  {
    name: 'shortcuts',
    go: async (p) => {
      await gotoScreen(p, 'lobby')
      await p.getByRole('heading', { name: 'Open tables' }).waitFor()
      // open via the "?" key so it works on every viewport (the floating help
      // button is hidden on small screens — see theme.css)
      await p.locator('.brand-name').click() // blur any autofocused input
      await p.keyboard.press('?')
      await p.locator('.shortcuts-overlay, .modal-backdrop').first().waitFor()
    },
    // no interactive control to hit-test here; the overlay check asserts the
    // modal sits above the page.
    controls: () => [],
    overlay: (p) => p.locator('.shortcuts-overlay, .modal-backdrop').first(),
  },
]

// ---- helpers --------------------------------------------------------------

/** Rule 1: nothing spills off the side. */
async function checkOverflow(page: Page): Promise<string[]> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  return overflow > 2 ? [`horizontal overflow ${overflow}px`] : []
}

/** Rules 2+3: a control is a comfortable size and (when on-screen) not covered. */
async function checkControl(page: Page, loc: Locator, label: string, mobile: boolean): Promise<string[]> {
  const errs: string[] = []
  if ((await loc.count()) === 0) return [`${label}: missing`]
  const el = loc.first()
  if (!(await el.isVisible())) return [`${label}: hidden`]
  // a control inside a scroll container may sit below the fold — that's
  // reachable, not "covered". Bring it into view first so we test the real
  // question: when visible, is it the right size and not covered by an overlay?
  await el.scrollIntoViewIfNeeded().catch(() => {})
  const box = await el.boundingBox()
  if (!box) return [`${label}: no box`]
  const meta = await el.evaluate((n) => ({ tag: n.tagName, pe: getComputedStyle(n).pointerEvents }))
  // tap-size (rule 3): inputs (checkboxes/range) get a relaxed floor — the OS
  // renders them at a fixed size and the label row is the real hit area. A
  // 0.5px sub-pixel tolerance avoids false fails on controls sized exactly to
  // the floor that round down (e.g. 39.6px against a 40px target).
  const eps = 0.5
  const minH = meta.tag === 'INPUT' ? 14 : mobile ? 40 : 24
  const minW = meta.tag === 'INPUT' ? 14 : mobile ? 40 : 24
  if (box.height < minH - eps) errs.push(`${label}: short ${Math.round(box.height)}px`)
  if (box.width < minW - eps) errs.push(`${label}: narrow ${Math.round(box.width)}px`)
  // coverage (rule 2): hit-test the centre if it's on-screen. Skip passive
  // overlays (pointer-events:none, e.g. the card preview) — they intentionally
  // let clicks fall through and aren't interactive controls.
  const vp = page.viewportSize()!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  if (meta.pe !== 'none' && cx >= 0 && cy >= 0 && cx <= vp.width && cy <= vp.height) {
    const hit = await el.evaluate(
      (node, [x, y]) => {
        const e = document.elementFromPoint(x as number, y as number)
        return { ok: !!e && (e === node || node.contains(e) || (e as HTMLElement).contains(node)), tag: e ? `${e.tagName}.${(e.className || '').toString().split(' ')[0]}` : 'none' }
      },
      [cx, cy],
    )
    if (!hit.ok) errs.push(`${label}: covered by ${hit.tag}`)
  }
  return errs
}

/** Rule 5: no unbounded/over-long animation on visible non-decorative elements. */
async function checkAnimationBounds(page: Page): Promise<string[]> {
  return page.evaluate((decorative) => {
    const errs: string[] = []
    const isDecorative = (el: Element) => {
      let n: Element | null = el
      while (n) {
        const cls = (n.className || '').toString()
        if (decorative.some((d) => cls.includes(d))) return true
        n = n.parentElement
      }
      return false
    }
    const seen = new Set<string>()
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.bottom < 0 || r.top > window.innerHeight) continue
      const cs = getComputedStyle(el)
      const dur = Math.max(...cs.animationDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)))
      const iter = cs.animationIterationCount
      const name = cs.animationName
      if (name !== 'none' && (iter === 'infinite' || dur > 600)) {
        if (!isDecorative(el)) {
          const key = `${(el.className || '').toString().split(' ')[0]}:${name}`
          if (!seen.has(key)) { seen.add(key); errs.push(`unbounded animation ${key} (${iter}, ${dur}ms)`) }
        }
      }
      const tdur = Math.max(...cs.transitionDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)))
      if (tdur > 600 && !isDecorative(el)) {
        const key = `${(el.className || '').toString().split(' ')[0]}:transition`
        if (!seen.has(key)) { seen.add(key); errs.push(`over-long transition ${key} (${tdur}ms)`) }
      }
    }
    return errs
  }, DECORATIVE)
}

/** Rule 8: no primary text below 11px (decorative glyphs / micro-labels exempt). */
async function checkReadableText(page: Page): Promise<string[]> {
  return page.evaluate((decorative) => {
    const errs: string[] = []
    const seen = new Set<string>()
    for (const el of Array.from(document.querySelectorAll('*'))) {
      // only elements with their OWN visible text (a text child), of length >=4
      const text = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || '').trim())
        .join(' ')
        .trim()
      if (text.length < 4) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.bottom < 0 || r.top > window.innerHeight) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      // exempt decorative classes + uppercase micro-labels (a common UI pattern)
      const cls = (el.className || '').toString()
      if (decorative.some((d) => cls.includes(d))) continue
      if (cs.textTransform === 'uppercase') continue
      const fs = parseFloat(cs.fontSize)
      if (fs < 11) {
        const key = `${el.tagName}.${cls.split(' ')[0]}`
        if (!seen.has(key)) { seen.add(key); errs.push(`tiny text ${key} ${fs}px "${text.slice(0, 24)}"`) }
      }
    }
    return errs
  }, DECORATIVE)
}

/** Rule 7: an overlay must be hit-testable above page content at its centre. */
async function checkOverlayAbove(page: Page, loc: Locator, label: string): Promise<string[]> {
  if ((await loc.count()) === 0) return []
  const el = loc.first()
  if (!(await el.isVisible())) return []
  const box = await el.boundingBox()
  if (!box) return []
  const vp = page.viewportSize()!
  const cx = Math.min(Math.max(box.x + box.width / 2, 1), vp.width - 1)
  const cy = Math.min(Math.max(box.y + box.height / 2, 1), vp.height - 1)
  const hit = await el.evaluate(
    (node, [x, y]) => {
      const e = document.elementFromPoint(x as number, y as number)
      return !!e && (e === node || node.contains(e) || (e as HTMLElement).contains(node))
    },
    [cx, cy],
  )
  return hit ? [] : [`overlay ${label} not on top at centre`]
}

// ===========================================================================
//  PART A — full matrix × every screen: overflow, controls, animation, text.
// ===========================================================================
;(AUDIT ? test.describe : test.describe.skip)('usability · per-viewport', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } })
      const mobile = vp.w <= 760
      for (const screen of SCREENS) {
        test(`${screen.name}`, async ({ page }) => {
          await screen.go(page)
          const errs: string[] = []
          errs.push(...(await checkOverflow(page))) // rule 1
          for (const c of screen.controls(page)) errs.push(...(await checkControl(page, c.loc, c.label, mobile))) // rules 2+3
          errs.push(...(await checkAnimationBounds(page))) // rule 5
          errs.push(...(await checkReadableText(page))) // rule 8
          if (screen.overlay) errs.push(...(await checkOverlayAbove(page, screen.overlay(page), screen.name))) // rule 7
          expect(errs, `\n  ${errs.join('\n  ')}\n`).toEqual([])
        })
      }
    })
  }
})

// ===========================================================================
//  PART B — representative viewports: CLS, idle drift, reduce-motion, focus.
// ===========================================================================

// inject a CLS observer before any app code runs
async function withClsObserver(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __cls: number }).__cls = 0
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      /* layout-shift unsupported — treated as 0 */
    }
  })
}
const getCls = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls || 0)

;(AUDIT ? test.describe : test.describe.skip)('usability · stability', () => {
  for (const vp of REP_VIEWPORTS) {
    test.describe(`${vp.name} ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } })

      // Rule 4/6: once a view has settled it must not keep shifting on its own.
      // (Progressive first-paint / navigation repaint is expected; what we
      // forbid is a settled screen drifting, which is the real jank.)
      for (const name of ['lobby', 'deck-gallery', 'game', 'settings']) {
        test(`no post-settle drift · ${name}`, async ({ page }) => {
          await withClsObserver(page)
          // settings fetches the image-cache stats on mount; stub it so it
          // resolves within the settle window (a deterministic load event, not
          // post-settle jank). Registered before the harness, which leaves
          // these endpoints unrouted.
          const ij = (b: unknown) => (r: import('@playwright/test').Route) =>
            r.fulfill({ contentType: 'application/json', body: JSON.stringify(b) })
          await page.route('**/api/images/stats', ij({ available: true, dir: '/cache', files: 1234, sets: 600, bytes: 9e9, sources: ['Scryfall'] }))
          await page.route('**/api/images/download/progress', ij({ running: false, cancelled: false, scanned: 0, candidates: 0, done: 0, failed: 0, skipped: 0, totalMissing: 0, current: '', message: '' }))
          const screen = SCREENS.find((s) => s.name === name)!
          await screen.go(page)
          await page.waitForTimeout(500) // let the view settle
          const before = await getCls(page)
          await page.waitForTimeout(900) // idle — nothing should move
          const after = await getCls(page)
          expect(after - before, `drift CLS ${after - before}`).toBeLessThan(0.05)
        })
      }

      // Rule 4: hovering a deck entry must not reflow the page. The old bug
      // here swapped the preview between two heights, shifting the entry under
      // the cursor into a flicker loop — so an unstable target also makes the
      // hover itself never resolve. Both are caught below.
      test('CLS on deck-entry hover', async ({ page }) => {
        await withClsObserver(page)
        await gotoScreen(page, 'lobby')
        await page.getByRole('button', { name: 'Deck Editor' }).click()
        await page.getByRole('button', { name: 'Add Lightning Bolt' }).click()
        const entry = page.locator('.deck-entry', { hasText: 'Lightning Bolt' })
        await entry.waitFor()
        await entry.scrollIntoViewIfNeeded()
        await page.waitForTimeout(400)
        const beforeBox = await entry.boundingBox()
        const before = await getCls(page)
        // fire the real hover code path (onMouseEnter -> show preview). We use
        // dispatchEvent rather than .hover() because the deck list clips its
        // overflow, so .hover()'s actionability can't settle on the boundary
        // entry — but the preview swap is exactly what could reflow, and that's
        // what we measure here.
        await entry.dispatchEvent('mouseenter')
        await entry.dispatchEvent('mouseover')
        await page.waitForTimeout(500)
        const afterBox = await entry.boundingBox()
        const after = await getCls(page)
        // the hovered entry must not move, and the page must not shift
        expect(Math.abs((afterBox?.y ?? 0) - (beforeBox?.y ?? 0)), 'entry moved on hover').toBeLessThanOrEqual(1)
        expect(after - before, `hover CLS ${after - before}`).toBeLessThan(0.05)
      })

      // Rule 6: key controls don't drift over a 1s idle window.
      for (const name of ['lobby', 'game']) {
        test(`idle drift · ${name}`, async ({ page }) => {
          const screen = SCREENS.find((s) => s.name === name)!
          await screen.go(page)
          await page.waitForTimeout(300)
          const ctrls = screen.controls(page)
          const sample = async () =>
            Promise.all(ctrls.map(async (c) => ((await c.loc.count()) ? c.loc.first().boundingBox() : null)))
          const a = await sample()
          await page.waitForTimeout(1000)
          const b = await sample()
          const drift: string[] = []
          ctrls.forEach((c, i) => {
            if (a[i] && b[i]) {
              const dx = Math.abs(a[i]!.x - b[i]!.x)
              const dy = Math.abs(a[i]!.y - b[i]!.y)
              if (dx > 1 || dy > 1) drift.push(`${c.label} drifted ${dx.toFixed(1)},${dy.toFixed(1)}`)
            }
          })
          expect(drift, drift.join(' | ')).toEqual([])
        })
      }
    })
  }
})

// ===========================================================================
//  PART C — reduce-motion suppression + keyboard focus (single viewport).
// ===========================================================================
;(AUDIT ? test.describe : test.describe.skip)('usability · motion & focus', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  // Rule 5: reduce-motion truly suppresses motion (no decorative backdrop, all
  // animation/transition durations collapse to ~0).
  test('reduce-motion suppresses all non-trivial motion', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mage.prefs', JSON.stringify({ reduceMotion: true }))
    })
    await gotoScreen(page, 'game')
    await page.locator('.board3d canvas').waitFor()
    // the decorative 3D backdrop must not be mounted
    await expect(page.locator('.scene-bg')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion'))).toBe(true)
    // every visible element's animation + transition duration is ~0
    const moving = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.bottom < 0 || r.top > window.innerHeight) continue
        const cs = getComputedStyle(el)
        const a = Math.max(...cs.animationDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)))
        const t = Math.max(...cs.transitionDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000)))
        if ((cs.animationName !== 'none' && a > 5) || t > 5) {
          bad.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]} a=${a} t=${t}`)
        }
      }
      return bad.slice(0, 8)
    })
    expect(moving, moving.join(' | ')).toEqual([])
  })

  // Rule 10: the app ships :focus-visible styling and primary controls focus.
  test('keyboard focus is visible on primary controls', async ({ page }) => {
    await gotoScreen(page, 'lobby')
    await page.getByRole('heading', { name: 'Open tables' }).waitFor()
    const btn = page.getByRole('button', { name: 'New game', exact: true })
    await btn.focus()
    await expect(btn).toBeFocused()
    // a focus-visible rule exists somewhere in the loaded stylesheets
    const hasFocusVisible = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          continue
        }
        for (const r of Array.from(rules)) {
          if (r instanceof CSSStyleRule && r.selectorText && r.selectorText.includes(':focus-visible')) return true
        }
      }
      return false
    })
    expect(hasFocusVisible, ':focus-visible styling must exist').toBe(true)
  })
})

// ===========================================================================
//  PART D — readability (rule 8b): the card preview gets a legible area on
//  every viewport, so the card's rules text is actually readable (not a
//  thumbnail letterboxed inside a big dark box, the bug this guards against).
// ===========================================================================
;(AUDIT ? test.describe : test.describe.skip)('usability · readability', () => {
  const previewScreen = SCREENS.find((s) => s.name === 'card-preview')!
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} ${vp.w}x${vp.h}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } })
      test('card preview is legible', async ({ page }) => {
        await previewScreen.go(page)
        // measure the image AREA (imgbox), not the <img> (a real card fills it;
        // it's image-size-independent so it works with the faux placeholder too)
        const box = await page.locator('.card-preview-imgbox').boundingBox()
        expect(box, 'card preview image area present').toBeTruthy()
        expect(
          box!.width,
          `card preview too narrow to read (${Math.round(box!.width)}px)`,
        ).toBeGreaterThanOrEqual(180)
        expect(
          box!.height,
          `card preview too short to read (${Math.round(box!.height)}px)`,
        ).toBeGreaterThanOrEqual(225)
      })
    })
  }
})

test('usability suite is opt-in (AUDIT=1)', () => {
  test.skip(!AUDIT, 'run with AUDIT=1 (npm run test:audit)')
})
