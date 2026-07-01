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
export const card = (
  id: string,
  name: string,
  types: string[],
  o: Partial<C> = {},
): C => ({ id, name, set: o.set ?? 'M21', num: o.num ?? '1', types, power: o.power ?? null, toughness: o.toughness ?? null, loyalty: o.loyalty ?? null, manaCost: o.manaCost ?? '', colors: o.colors ?? '', tapped: !!o.tapped, damage: o.damage ?? 0, targets: o.targets, sourceId: o.sourceId })

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
  | 'multiplayer'
  | 'game3p'
  | 'game4p'
  | 'arrows'
  | 'stack'
  | 'landstack'
  | 'ability'

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

// declared combat: the viewer's Serra Angel (b3) attacks the Computer, blocked
// by its Goblin Guide (a2) — exercises attack + block arrows. Paired with a
// target prompt selecting a2 to also exercise the targeting arrow.
const GAME_ARROWS = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
GAME_ARROWS.step = 'Declare Blockers'
GAME_ARROWS.combat = [{ attackers: ['b3'], blockers: ['a2'], defender: 'Computer', blocked: true }] as unknown[]

// the viewer controls a stack of 5 same-named Forests — 3 untapped (fl1..fl3),
// 2 tapped (fl4, fl5) — collapsed into one slot. Exercises the card menu's
// "tap N from a stack" + undo controls. All untapped lands are playable (tappable).
const GAME_LANDSTACK = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
{
  const you = GAME_LANDSTACK.players.find((p) => p.name === 'You')!
  you.battlefield = [
    card('fl1', 'Forest', ['Land'], { colors: 'G' }),
    card('fl2', 'Forest', ['Land'], { colors: 'G' }),
    card('fl3', 'Forest', ['Land'], { colors: 'G' }),
    card('fl4', 'Forest', ['Land'], { colors: 'G', tapped: true }),
    card('fl5', 'Forest', ['Land'], { colors: 'G', tapped: true }),
    card('b3', 'Serra Angel', ['Creature'], { power: '4', toughness: '4', colors: 'W' }),
  ]
  GAME_LANDSTACK.canPlay = ['fl1', 'fl2', 'fl3', 'b3']
}

// a four-player Free For All board to exercise radial seating + multiplayer UI
const GAME_MULTI = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
GAME_MULTI.players = [
  {
    id: 'me', name: 'You', life: 20, libraryCount: 28, handCount: 4, graveyardCount: 0, active: true, manaPool: '{G}',
    battlefield: [card('m1', 'Forest', ['Land'], { colors: 'G' }), card('m2', 'Llanowar Elves', ['Creature'], { power: '1', toughness: '1', colors: 'G' })],
    graveyard: [], exile: [],
  },
  {
    id: 'p2', name: 'Chandra', life: 17, libraryCount: 30, handCount: 6, graveyardCount: 1, active: false,
    battlefield: [card('q1', 'Mountain', ['Land'], { colors: 'R', tapped: true }), card('q2', 'Goblin Guide', ['Creature'], { power: '2', toughness: '2', colors: 'R' })],
    graveyard: [], exile: [],
  },
  {
    id: 'p3', name: 'Teferi', life: 22, libraryCount: 33, handCount: 5, graveyardCount: 0, active: false,
    battlefield: [card('r1', 'Island', ['Land'], { colors: 'U' }), card('r2', 'Island', ['Land'], { colors: 'U' }), card('r3', 'Serra Angel', ['Creature'], { power: '4', toughness: '4', colors: 'W' })],
    graveyard: [], exile: [],
  },
  {
    id: 'p4', name: 'Vraska', life: 14, libraryCount: 25, handCount: 3, graveyardCount: 4, active: false,
    battlefield: [card('s1', 'Swamp', ['Land'], { colors: 'B' }), card('s2', 'Sengir Vampire', ['Creature'], { power: '4', toughness: '4', colors: 'B' })],
    graveyard: [], exile: [],
  },
] as typeof SAMPLE.game.players

// ---- worst-case dense multiplayer boards (3p / 4p, maxed-out card layouts) ----
const CREATURE_POOL = [
  'Serra Angel', 'Goblin Guide', 'Llanowar Elves', 'Sengir Vampire', 'Grizzly Bears',
  'Shivan Dragon', 'Air Elemental', 'Hill Giant', 'Wall of Omens', 'Elvish Mystic',
  'Phantom Monster', 'Bog Wraith', 'Craw Wurm', 'Prodigal Sorcerer',
]
function densePlayer(
  pre: string, name: string, life: number, color: string, landName: string, active: boolean, me = false,
) {
  const lands = Array.from({ length: 8 }, (_, i) =>
    card(`${pre}L${i}`, landName, ['Land'], { colors: color, tapped: i % 3 === 0 }),
  )
  const creatures = CREATURE_POOL.slice(0, 10).map((cn, i) =>
    card(`${pre}C${i}`, cn, ['Creature'], {
      colors: color, power: String(1 + (i % 9)), toughness: String(1 + ((i + 3) % 9)), tapped: i % 4 === 0,
    }),
  )
  // non-creature, non-land permanents go in their own (middle) battlefield row
  const others = [
    card(`${pre}A0`, 'Sol Ring', ['Artifact'], { tapped: true }),
    card(`${pre}A1`, 'Howling Mine', ['Artifact'], {}),
    card(`${pre}E0`, 'Rancor', ['Enchantment'], { colors: color }),
    card(`${pre}P0`, 'Garruk Wildspeaker', ['Planeswalker'], { colors: color, loyalty: '3' }),
  ]
  return {
    id: pre, name, life, libraryCount: 47, handCount: me ? 7 : 6, graveyardCount: 6, exileCount: 3,
    active, manaPool: me ? '{G}{G}{U}{R}' : undefined,
    battlefield: [...lands, ...others, ...creatures],
    graveyard: Array.from({ length: 3 }, (_, i) => card(`${pre}G${i}`, CREATURE_POOL[i], ['Creature'], { colors: color })),
    exile: [],
  }
}
function denseGame(seats: Array<[string, string, number, string, string]>) {
  const g = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
  g.turn = 14
  g.players = seats.map(([pre, name, life, color, land], i) =>
    densePlayer(pre, name, life, color, land, i === 0, pre === 'me'),
  ) as typeof SAMPLE.game.players
  // a busy stack and full combat: the viewer's creatures swing at everyone
  g.stack = [
    card('xs1', 'Exalted Sunborn', ['Creature'], { manaCost: '{3}{W}{W}', colors: 'W' }),
    card('xs2', 'Lightning Bolt', ['Instant'], { manaCost: '{R}', colors: 'R' }),
    card('xs3', 'Counterspell', ['Instant'], { manaCost: '{U}{U}', colors: 'U' }),
  ] as typeof SAMPLE.game.stack
  g.step = 'Declare Attackers'
  const me = g.players[0]
  const others = g.players.slice(1)
  g.combat = me.battlefield
    .filter((c) => c.types?.includes('Creature'))
    .slice(0, 6)
    .map((c, i) => ({ attackers: [c.id], blockers: [], defender: others[i % others.length].name, blocked: false })) as unknown[]
  return g
}
// viewer + 2 opponents, and viewer + 3 opponents, all with maxed boards
const GAME_3P_MAX = denseGame([
  ['me', 'You', 20, 'G', 'Forest'],
  ['p2', 'Chandra', 13, 'R', 'Mountain'],
  ['p3', 'Teferi', 31, 'U', 'Island'],
])
const GAME_4P_MAX = denseGame([
  ['me', 'You', 20, 'G', 'Forest'],
  ['p2', 'Chandra', 13, 'R', 'Mountain'],
  ['p3', 'Teferi', 31, 'U', 'Island'],
  ['p4', 'Vraska', 8, 'B', 'Swamp'],
])

const GAME_STACK = JSON.parse(JSON.stringify(SAMPLE.game)) as typeof SAMPLE.game
GAME_STACK.stack = [
  card('st1', 'Lightning Bolt', ['Instant'], { manaCost: '{R}', colors: 'R' }),
  card('st2', 'Counterspell', ['Instant'], { manaCost: '{U}{U}', colors: 'U' }),
] as typeof SAMPLE.game.stack

// a 1x1 jpeg so the 3D board's card textures resolve deterministically
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwD/2Q==',
  'base64',
)

/** Install REST stubs + a mock WebSocket so the app runs with no real backend. */
export async function installMocks(
  page: Page,
  scenario: Scenario,
  opts: { resume?: boolean; game?: unknown; prompt?: unknown } = {},
) {
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
  const gameState =
    opts.game ??
    (scenario === 'multiplayer' ? GAME_MULTI
    : scenario === 'game3p' ? GAME_3P_MAX
    : scenario === 'game4p' ? GAME_4P_MAX
    : scenario === 'arrows' ? GAME_ARROWS
    : scenario === 'stack' ? GAME_STACK
    : scenario === 'landstack' || scenario === 'ability' ? GAME_LANDSTACK
    : SAMPLE.game)
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
              // test hook: re-push a game state with an arbitrary prompt (or the
              // current one) so tests can drive the tap-queue drain / ability picker
              ;(window as unknown as { __push: (p?: unknown) => void }).__push = (p?: unknown) =>
                this.emit({ type: 'game', gameId: 'g-1', game, prompt: p === undefined ? prompt : p })
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
      gameState,
      opts.prompt !== undefined
        ? opts.prompt
        : scenario === 'arrows'
        ? { ...SAMPLE.prompts.target, targets: ['a2'] }
        : (SAMPLE.prompts as Record<string, unknown>)[promptKey],
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
  await page.route('**/api/decks/import', json({
    name: 'Imported deck',
    cards: [{ name: 'Lightning Bolt', count: 4, manaValue: 1, colors: 'R', types: ['INSTANT'], manaCost: '{R}' }],
    sideboard: [],
    unresolved: ['Fake Card'],
  }))
  await page.route('**/api/decks/upload', json({ ok: true, name: 'Imported Deck', path: '/decks/imported.dck' }))
  await page.route('**/api/cards/search**', json(SAMPLE.cards))
  await page.route('**/api/gametypes**', json([
    { name: 'Two Player Duel', minPlayers: 2, maxPlayers: 2, useRange: false, useAttackOption: false },
    { name: 'Free For All', minPlayers: 2, maxPlayers: 10, useRange: true, useAttackOption: true },
  ]))
  await page.route('**/api/tables/create', json({ ok: true, tableId: 'g-1', started: true, openSeats: 0 }))
  await page.route('**/api/tables/start', json({ ok: true }))
  await page.route('**/api/tables/add-ai', json({ ok: true }))
  await page.route('**/api/tables/remove', json({ ok: true }))
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
  // Return a stub html2canvas that resolves immediately so screenshot capture
  // doesn't add seconds of latency to every report-related test.
  await page.route('**/html2canvas.esm-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      body: `const c={toDataURL:()=>'data:image/jpeg;base64,/9j/'};export default async function(){return c}`,
    }),
  )
}

/** Navigate and land on the requested screen with minimal setup. */
export async function gotoScreen(page: Page, scenario: Scenario) {
  await installMocks(page, scenario)
  await page.goto('/')
}

/** Boot straight into the interactive board with a hand-crafted game state (and an
 *  optional prompt). Used by the card-effects visual-verification suite to push
 *  arbitrary 1v1 boards and assert the rendered visuals match the state. */
export async function gotoCustomGame(page: Page, game: unknown, prompt?: unknown) {
  await installMocks(page, 'game', { game, prompt: prompt ?? SAMPLE.prompts.select })
  await page.goto('/')
}
