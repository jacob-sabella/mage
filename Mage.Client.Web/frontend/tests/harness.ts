import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Sample data — the "faux" backend. These describe what the UI SHOULD show, so
// tests assert against them and you can jump straight to any screen.
// ---------------------------------------------------------------------------

type C = {
  id: string
  name: string
  set: string
  num: string
  types: string[]
  power?: string | null
  toughness?: string | null
  loyalty?: string | null
  manaCost?: string
  colors?: string
  tapped?: boolean
  damage?: number
}
const card = (
  id: string,
  name: string,
  types: string[],
  o: Partial<C> = {},
): C => ({ id, name, set: o.set ?? 'M21', num: o.num ?? '1', types, power: o.power ?? null, toughness: o.toughness ?? null, loyalty: o.loyalty ?? null, manaCost: o.manaCost ?? '', colors: o.colors ?? '', tapped: !!o.tapped, damage: o.damage ?? 0 })

export const SAMPLE = {
  tables: [
    { id: 't1', name: "Aggro Duel", gameType: 'Two Player Duel', controller: 'Jaya', seats: '1/2', state: 'Waiting', skillLevel: 'Casual', games: [] as string[] },
    { id: 't2', name: 'Live Duel', gameType: 'Two Player Duel', controller: 'Liliana', seats: '2/2', state: 'Dueling', skillLevel: 'Serious', games: ['g-live'] },
  ],
  decks: [
    { name: 'Mono Red Aggro', path: '/decks/red.dck', category: 'Decks to Beat' },
    { name: 'Azorius Control', path: '/decks/uw.dck', category: 'Decks to Beat' },
    { name: 'bunny', path: '/home/jsabella/bunny.dck', category: 'My decks' },
  ],
  cards: [
    { name: 'Lightning Bolt', manaCost: '{R}', colors: 'R', types: ['INSTANT'], set: '2X2', rarity: 'Common', manaValue: 1 },
    { name: 'Counterspell', manaCost: '{U}{U}', colors: 'U', types: ['INSTANT'], set: 'MH2', rarity: 'Common', manaValue: 2 },
    { name: 'Serra Angel', manaCost: '{3}{W}{W}', colors: 'W', types: ['CREATURE'], set: 'DMR', rarity: 'Uncommon', manaValue: 5 },
  ],
  deckLoad: {
    name: 'Mono Red Aggro',
    cards: [
      { name: 'Lightning Bolt', count: 4, manaValue: 1, colors: 'R', types: ['INSTANT'], manaCost: '{R}' },
      { name: 'Mountain', count: 20, manaValue: 0, colors: '', types: ['LAND'], manaCost: '' },
    ],
    sideboard: [{ name: 'Smash to Smithereens', count: 2, manaValue: 3, colors: 'R', types: ['INSTANT'], manaCost: '{2}{R}' }],
  },
  matches: [
    { name: "Aggro Duel", gameType: 'Two Player Duel', players: 'You, Computer', result: 'You [1-0], Computer [0-1]', replayAvailable: false, endTime: 1700000000000, games: ['g1'] },
  ],
  game: {
    turn: 3,
    phase: 'Main',
    step: 'Precombat Main',
    activePlayer: 'You',
    priorityPlayer: 'You',
    me: 'You',
    players: [
      {
        id: 'ai', name: 'Computer', life: 18, libraryCount: 30, handCount: 5, graveyardCount: 2, active: false,
        battlefield: [card('a1', 'Mountain', ['Land'], { colors: 'R', tapped: true }), card('a2', 'Goblin Guide', ['Creature'], { power: '2', toughness: '2', colors: 'R' })],
        graveyard: [card('ag', 'Shock', ['Instant'], { colors: 'R' })], exile: [],
      },
      {
        id: 'me', name: 'You', life: 20, libraryCount: 28, handCount: 4, graveyardCount: 0, active: true, manaPool: '{U}{U}{R}',
        battlefield: [card('b1', 'Island', ['Land'], { colors: 'U' }), card('b2', 'Island', ['Land'], { colors: 'U' }), card('b3', 'Serra Angel', ['Creature'], { power: '4', toughness: '4', colors: 'W' })],
        graveyard: [], exile: [],
      },
    ],
    stack: [],
    canPlay: ['h1', 'h3', 'b3'],
    myHand: [card('h1', 'Lightning Bolt', ['Instant'], { colors: 'R', manaCost: '{R}' }), card('h2', 'Mountain', ['Land'], { colors: 'R' }), card('h3', 'Mulldrifter', ['Creature'], { power: '2', toughness: '2', colors: 'U', manaCost: '{4}{U}' }), card('h4', 'Counterspell', ['Instant'], { colors: 'U', manaCost: '{U}{U}' })],
    combat: [] as unknown[],
  },
  prompts: {
    select: { kind: 'select', message: 'Play spells and abilities', canCancel: true, min: 0, max: 0, choices: [], choiceKind: 'string', targets: [] },
    mulligan: { kind: 'ask', message: "Mulligan <font color='#ffff00'>down to 6 cards</font>?", canCancel: false, min: 0, max: 0, choices: [], choiceKind: 'string', targets: [] },
    target: { kind: 'target', message: 'Choose a target creature', canCancel: true, min: 0, max: 0, choices: [], choiceKind: 'string', targets: [] },
    attackers: { kind: 'select', message: 'Declare attackers — click creatures, then Done', canCancel: false, min: 0, max: 0, choices: [], choiceKind: 'string', targets: [] },
    pile: {
      kind: 'pile',
      message: 'Choose a pile to put into your hand (Fact or Fiction)',
      canCancel: false, min: 0, max: 0, choices: [], choiceKind: 'string', targets: [],
      pile1: [card('p1', 'Mulldrifter', ['Creature']), card('p2', 'Island', ['Land'])],
      pile2: [card('p3', 'Counterspell', ['Instant'])],
    },
    multiAmount: {
      kind: 'multiAmount',
      message: 'Distribute 3 damage among targets',
      canCancel: false, min: 3, max: 3, choices: [], choiceKind: 'string', targets: [],
      multi: [
        { label: 'Goblin Guide', min: 0, max: 3, def: 0 },
        { label: 'Serra Angel', min: 0, max: 3, def: 0 },
      ],
    },
  },
}

export type Scenario =
  | 'lobby'
  | 'game'
  | 'mulligan'
  | 'target'
  | 'combat'
  | 'pile'
  | 'multiAmount'
  | 'ptUpdate'
  | 'draft'
  | 'construct'
  | 'gameOver'

const DRAFT = {
  booster: [
    { id: 'd1', name: 'Loxodon Line Breaker', set: 'M19', num: '17' },
    { id: 'd2', name: 'Disperse', set: 'M19', num: '50' },
    { id: 'd3', name: 'Trumpet Blast', set: 'M19', num: '156' },
  ],
  picks: [{ id: 'd0', name: 'Goblin Instigator', set: 'M19', num: '146' }],
  timeout: 0,
}

// the same board, but the viewer's Serra Angel has been buffed to 6/6 — used to
// assert that a P/T change pushed by the server updates the on-board indicator.
const GAME_BUFFED = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
const buffed = GAME_BUFFED.players.find((p) => p.name === 'You')!.battlefield.find((c) => c.name === 'Serra Angel')!
buffed.power = '6'
buffed.toughness = '6'

// a 1x1 jpeg so the 3D board's card textures resolve deterministically
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwD/2Q==',
  'base64',
)

/** Install REST stubs + a mock WebSocket so the app runs with no real backend. */
export async function installMocks(page: Page, scenario: Scenario, opts: { resume?: boolean } = {}) {
  // resume = pre-seed a session so the app lands on the lobby (skip login).
  const resume = opts.resume ?? true

  // Seed a session (so the app auto-resumes to the lobby) and the scenario.
  await page.addInitScript(
    ([scen, doResume]) => {
      if (doResume) localStorage.setItem('mage.session', JSON.stringify({ token: 'tkn', server: 'localhost:17171' }))
      ;(window as unknown as { __SCENARIO: string }).__SCENARIO = scen as string
    },
    [scenario, resume] as [string, boolean],
  )

  // Mock WebSocket: emit ready, then for game scenarios push gameStart + game.
  const promptKey =
    scenario === 'mulligan'
      ? 'mulligan'
      : scenario === 'target'
        ? 'target'
        : scenario === 'combat'
          ? 'attackers'
          : scenario === 'pile'
            ? 'pile'
            : scenario === 'multiAmount'
              ? 'multiAmount'
              : 'select'
  const second = scenario === 'ptUpdate' ? GAME_BUFFED : null
  const isDraft = scenario === 'draft'
  const isConstruct = scenario === 'construct'
  // a small drafted pool for the construct screen
  const CONSTRUCT_POOL = Array.from({ length: 42 }, (_, i) => ({
    id: 'c' + i,
    name: i % 3 === 0 ? 'Goblin Instigator' : i % 3 === 1 ? 'Shock' : 'Sleep',
    set: 'M19',
    num: String(140 + i),
    colors: 'R',
  }))
  await page.addInitScript(
    ([game, prompt, isGame, secondGame, draftOn, draftData, constructOn, constructPool, overOn]) => {
      class MockWS {
        onopen: ((e: unknown) => void) | null = null
        onclose: ((e: unknown) => void) | null = null
        onmessage: ((e: { data: string }) => void) | null = null
        readyState = 1
        constructor(public url: string) {
          setTimeout(() => {
            this.onopen?.({})
            this.emit({ type: 'ready', payload: 'connected' })
            this.emit({ type: 'chat', user: 'System', text: 'Welcome.', color: 'BLUE', time: Date.now() })
            if (isGame) {
              setTimeout(() => {
                this.emit({ type: 'gameStart', gameId: 'g-1' })
                this.emit({ type: 'log', text: 'Precombat Main — your turn' })
                this.emit({ type: 'game', gameId: 'g-1', game, prompt })
                if (secondGame) {
                  setTimeout(() => this.emit({ type: 'game', gameId: 'g-1', game: secondGame, prompt }), 500)
                }
                if (overOn) {
                  setTimeout(() => this.emit({ type: 'gameOver', gameId: 'g-1', text: 'You have won the game.', game }), 400)
                }
              }, 150)
            }
            if (draftOn) {
              setTimeout(() => {
                this.emit({ type: 'draftStart', draftId: 'd-1' })
                this.emit({ type: 'draftPick', draftId: 'd-1', draft: draftData })
              }, 150)
            }
            if (constructOn) {
              setTimeout(() => this.emit({ type: 'construct', tableId: 't-draft', pool: constructPool }), 150)
            }
          }, 30)
        }
        emit(o: unknown) {
          this.onmessage?.({ data: JSON.stringify(o) })
        }
        send() {}
        close() {
          this.readyState = 3
          this.onclose?.({})
        }
        addEventListener() {}
        removeEventListener() {}
      }
      ;(window as unknown as { WebSocket: unknown }).WebSocket = MockWS
    },
    [
      SAMPLE.game,
      (SAMPLE.prompts as Record<string, unknown>)[promptKey],
      scenario !== 'lobby' && !isDraft && !isConstruct,
      second,
      isDraft,
      DRAFT,
      isConstruct,
      CONSTRUCT_POOL,
      scenario === 'gameOver',
    ] as [unknown, unknown, boolean, unknown, boolean, unknown, boolean, unknown, boolean],
  )

  const json = (body: unknown) => async (route: import('@playwright/test').Route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('**/api/connect', json({ token: 'tkn', server: 'localhost:17171' }))
  await page.route('**/api/session**', json({ ok: true, server: 'localhost:17171' }))
  await page.route('**/api/tables?**', json(SAMPLE.tables))
  await page.route('**/api/matches**', json(SAMPLE.matches))
  await page.route('**/api/decks/list', json(SAMPLE.decks))
  await page.route('**/api/decks/load**', json(SAMPLE.deckLoad))
  await page.route('**/api/decks/save', json({ ok: true, path: '/decks/out.dck' }))
  await page.route('**/api/cards/search**', json(SAMPLE.cards))
  await page.route('**/api/tables/create', json({ ok: true, tableId: 'g-1' }))
  await page.route('**/api/draft/create', json({ ok: true, tableId: 'd-1' }))
  await page.route('**/api/draft/pick', json({ ok: true }))
  await page.route('**/api/game/respond', json({ ok: true }))
  await page.route('**/api/watch', json({ ok: true }))
  await page.route('**/api/join', json({ ok: true }))
  await page.route('**/api/chat', json({ ok: true }))
  await page.route('**/api/disconnect', json({ ok: true }))
  await page.route('**/api/cardimg**', (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: TINY_JPEG }),
  )
}

/** Navigate and land on the requested screen with minimal setup. */
export async function gotoScreen(page: Page, scenario: Scenario) {
  await installMocks(page, scenario)
  await page.goto('/')
}
