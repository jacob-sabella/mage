import { test, expect, type Page } from '@playwright/test'
import { gotoCustomGame, card, SAMPLE } from './harness'

/*
 * ===========================================================================
 *  CARD-EFFECTS VISUAL VERIFICATION
 * ===========================================================================
 *  Pushes hand-crafted 1v1 board states — one per renderable card-effect /
 *  visual category the client's game model can express — and asserts the
 *  RENDERED visuals match the underlying game state, surfacing mismatches.
 *
 *  The client's GameCard model bounds what's verifiable: types, power/toughness,
 *  loyalty, tapped, damage, manaCost, colors, plus zones (battlefield rows /
 *  hand / library / graveyard / exile), the stack (spells + source-named
 *  abilities), combat (attackers/blockers), mana pool, and life.
 * ===========================================================================
 */

type C = ReturnType<typeof card>
interface Build {
  myField?: C[]
  oppField?: C[]
  myHand?: C[]
  myGrave?: C[]
  myExile?: C[]
  stack?: C[]
  combat?: unknown[]
  myMana?: string
  myLife?: number
  oppLife?: number
  myLib?: number
}

/** Build a minimal valid 1v1 game: opponent first (back seat), viewer 'You'. */
function mkGame(b: Build) {
  return {
    turn: 5,
    phase: 'Main',
    step: 'Precombat Main',
    activePlayer: 'You',
    priorityPlayer: 'You',
    me: 'You',
    players: [
      {
        id: 'ai', name: 'Computer', life: b.oppLife ?? 20, libraryCount: 30, handCount: 5,
        graveyardCount: 0, active: false, battlefield: b.oppField ?? [], graveyard: [], exile: [],
      },
      {
        id: 'me', name: 'You', life: b.myLife ?? 20, libraryCount: b.myLib ?? 30,
        handCount: (b.myHand ?? []).length, graveyardCount: (b.myGrave ?? []).length,
        active: true, manaPool: b.myMana, battlefield: b.myField ?? [],
        graveyard: b.myGrave ?? [], exile: b.myExile ?? [],
      },
    ],
    stack: b.stack ?? [],
    canPlay: [],
    myHand: b.myHand ?? [],
    combat: b.combat ?? [],
  }
}

async function boot(page: Page, b: Build, prompt?: unknown) {
  await gotoCustomGame(page, mkGame(b), prompt)
  await expect(page.locator('.board3d canvas')).toBeVisible({ timeout: 15_000 })
  await page.waitForFunction(() => !!(window as unknown as { __board3d?: unknown }).__board3d, null, { timeout: 15_000 })
}

type Rendered = { id: string; tapped: boolean; onScreen: boolean }
const rendered = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: { rendered(): Rendered[] } }).__board3d.rendered()) as Promise<Rendered[]>

type Badge = { cardId: string; text: string; onScreen: boolean }
const badges = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board3d: { badges(): Badge[] } }).__board3d.badges()) as Promise<Badge[]>
const isPT = (t: string) => /^\d+\/\d+$/.test(t)

test.describe('Card-effect visual verification (1v1)', () => {
  test('creatures show their P/T badge; lands / non-creatures do not', async ({ page }) => {
    await boot(page, {
      myField: [
        card('c1', 'Grizzly Bears', ['Creature'], { power: '2', toughness: '2', colors: 'G' }),
        card('c2', 'Serra Angel', ['Creature'], { power: '4', toughness: '4', colors: 'W' }),
        card('l1', 'Forest', ['Land'], { colors: 'G' }),
        card('a1', 'Sol Ring', ['Artifact']),
      ],
    })
    await expect.poll(async () => (await badges(page)).filter((b) => isPT(b.text)).map((b) => b.text).sort()).toEqual(['2/2', '4/4'])
    // land + artifact get no P/T badge → exactly two, both on-screen
    expect((await badges(page)).filter((b) => isPT(b.text) && b.onScreen)).toHaveLength(2)
  })

  test('a damaged creature shows its marked combat damage on the board', async ({ page }) => {
    await boot(page, {
      myField: [
        card('d1', 'Hurt Bear', ['Creature'], { power: '4', toughness: '4', damage: 3, colors: 'G' }),
        card('d2', 'Fine Bear', ['Creature'], { power: '2', toughness: '2', damage: 0, colors: 'G' }),
      ],
    })
    await expect.poll(async () => (await badges(page)).filter((b) => b.text.startsWith('−')).map((b) => b.text)).toEqual(['−3'])
  })

  test('planeswalkers show their loyalty badge', async ({ page }) => {
    await boot(page, {
      myField: [card('p1', 'Garruk Wildspeaker', ['Planeswalker'], { loyalty: '3', colors: 'G' })],
    })
    await expect.poll(async () => (await badges(page)).map((b) => b.text)).toEqual(['3'])
    expect((await badges(page)).some((b) => isPT(b.text))).toBe(false) // not a creature
  })

  test('tapped permanents render rotated; untapped do not', async ({ page }) => {
    await boot(page, {
      myField: [
        card('t1', 'Tapped Bear', ['Creature'], { power: '2', toughness: '2', tapped: true, colors: 'G' }),
        card('t2', 'Ready Bear', ['Creature'], { power: '3', toughness: '3', tapped: false, colors: 'G' }),
      ],
    })
    const r = await rendered(page)
    expect(r.find((c) => c.id === 't1')?.tapped, 'tapped creature should render tapped').toBe(true)
    expect(r.find((c) => c.id === 't2')?.tapped, 'untapped creature should not render tapped').toBe(false)
  })

  test('same-named lands collapse into one ×N stack', async ({ page }) => {
    await boot(page, {
      myField: Array.from({ length: 5 }, (_, i) => card('f' + i, 'Forest', ['Land'], { colors: 'G' })),
    })
    // five Forests render as a single slot badged ×5
    await expect(page.locator('.c3d-badge.c3d-stack', { hasText: '×5' })).toHaveCount(1)
  })

  test('mana pool renders one pip per floating mana', async ({ page }) => {
    await boot(page, { myMana: '{G}{G}{U}{R}' })
    await expect(page.locator('.pstat', { hasText: 'You' }).locator('.mana-pip')).toHaveCount(4)
  })

  test('hand cards show their mana cost as pips', async ({ page }) => {
    await boot(page, {
      myHand: [
        card('h1', 'Counterspell', ['Instant'], { manaCost: '{U}{U}', colors: 'U' }),
        card('h2', 'Lightning Bolt', ['Instant'], { manaCost: '{R}', colors: 'R' }),
      ],
    })
    await expect(page.locator('.hand-card')).toHaveCount(2)
    await expect(page.locator('.hand-card-cost .mana-pip', { hasText: 'U' })).toHaveCount(2)
  })

  test('life totals render for both players', async ({ page }) => {
    await boot(page, { myLife: 17, oppLife: 11 })
    await expect(page.locator('.pstat', { hasText: 'You' })).toContainText('17')
    await expect(page.locator('.pstat', { hasText: 'Computer' })).toContainText('11')
  })

  test('graveyard / exile counts render on the zone piles', async ({ page }) => {
    await boot(page, {
      myGrave: [card('g1', 'Shock', ['Instant']), card('g2', 'Bolt', ['Instant'])],
      myExile: [card('e1', 'Path', ['Instant'])],
      myLib: 42,
    })
    await expect(page.locator('.c3d-zone', { hasText: 'GY 2' })).toHaveCount(1)
    await expect(page.locator('.c3d-zone', { hasText: 'Exile 1' })).toHaveCount(1)
    await expect(page.locator('.c3d-zone', { hasText: 'Lib 42' })).toHaveCount(1)
  })

  test('spells on the stack render and are counted', async ({ page }) => {
    await boot(page, {
      stack: [
        card('s1', 'Exalted Sunborn', ['Creature'], { manaCost: '{3}{W}{W}', colors: 'W' }),
        card('s2', 'Counterspell', ['Instant'], { manaCost: '{U}{U}', colors: 'U' }),
      ],
    })
    await expect(page.locator('.stack-panel .stack-title')).toContainText('Stack (2)')
    await expect(page.locator('.stack-item')).toHaveCount(2)
  })

  test('an activated/triggered ability on the stack shows its source card', async ({ page }) => {
    await boot(page, {
      stack: [
        card('ab1', 'Ability', [], { manaCost: '', }),
      ].map((c) => ({ ...c, sourceName: 'Llanowar Elves', sourceSet: 'M21', sourceNum: '1' })),
    })
    await expect(page.locator('.stack-item', { hasText: 'Llanowar Elves' })).toHaveCount(1)
  })

  test('combat renders attack (blocked → gray) + block arrows on the board', async ({ page }) => {
    await boot(page, {
      myField: [card('atk', 'Serra Angel', ['Creature'], { power: '4', toughness: '4', colors: 'W' })],
      oppField: [card('blk', 'Goblin Guide', ['Creature'], { power: '2', toughness: '2', colors: 'R' })],
      combat: [{ attackers: ['atk'], blockers: ['blk'], defender: 'Computer', blocked: true }],
    })
    await expect
      .poll(async () =>
        (
          (await page.evaluate(() => (window as unknown as { __board3d: { arrows(): { kind: string }[] } }).__board3d.arrows())) ?? []
        )
          .map((a) => a.kind)
          .sort(),
      )
      .toEqual(['attackBlocked', 'block'])
  })

  test('soulbond-paired creatures draw a green pair arrow (one per pair)', async ({ page }) => {
    await boot(page, {
      myField: [
        card('sb1', 'Trusted Forcemage', ['Creature'], { power: '2', toughness: '2', colors: 'G', pairedCard: 'sb2' }),
        card('sb2', 'Wolfir Avenger', ['Creature'], { power: '3', toughness: '3', colors: 'G', pairedCard: 'sb1' }),
      ],
    })
    await expect
      .poll(async () =>
        (
          (await page.evaluate(() => (window as unknown as { __board3d: { arrows(): { kind: string }[] } }).__board3d.arrows())) ?? []
        ).map((a) => a.kind),
      )
      .toEqual(['paired'])
  })

  test('a spell on the stack draws an arrow to its target (no prompt needed)', async ({ page }) => {
    await boot(page, {
      oppField: [card('victim', 'Goblin Guide', ['Creature'], { power: '2', toughness: '2', colors: 'R' })],
      stack: [card('bolt', 'Lightning Bolt', ['Instant'], { colors: 'R', targets: ['victim'] })],
    })
    await expect
      .poll(async () =>
        (
          (await page.evaluate(() => (window as unknown as { __board3d: { arrows(): { kind: string }[] } }).__board3d.arrows())) ?? []
        ).some((a) => a.kind === 'target'),
      )
      .toBe(true)
  })

  test('a target prompt draws a targeting arrow', async ({ page }) => {
    await boot(
      page,
      { oppField: [card('tgt', 'Goblin Guide', ['Creature'], { power: '2', toughness: '2', colors: 'R' })] },
      { ...SAMPLE.prompts.target, targets: ['tgt'] },
    )
    await expect
      .poll(async () =>
        (
          (await page.evaluate(() => (window as unknown as { __board3d: { arrows(): { kind: string }[] } }).__board3d.arrows())) ?? []
        ).some((a) => a.kind === 'target'),
      )
      .toBe(true)
  })
})
