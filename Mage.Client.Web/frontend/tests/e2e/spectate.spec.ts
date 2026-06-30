import { test, expect, type Page } from '@playwright/test'
import { appendFileSync, writeFileSync } from 'node:fs'

// Playwright buffers a test's console.log until it finishes, so also stream every
// line to a stable file you can `tail -f` live: /tmp/xmage-spectate.log
const LIVE_LOG = '/tmp/xmage-spectate.log'
function live(line: string) {
  console.log(line)
  try {
    appendFileSync(LIVE_LOG, line + '\n')
  } catch {
    /* best-effort */
  }
}

/*
 * ===========================================================================
 *  LIVE SPECTATOR HARNESS   (manual / on-demand — opt-in: SPECTATE=1)
 * ===========================================================================
 *  Connects the REAL web client (served by the local gateway on :8090) to a
 *  real server, finds a running game, spectates it, and continuously verifies
 *  invariants about the live game for as long as it's being played — then
 *  prints a report. Nothing is stubbed.
 *
 *  Run it:
 *    1. make sure the gateway is up on :8090  (scripts/run-gateway.sh)
 *    2. SPECTATE=1 npm run test:e2e -- spectate           (Beta server, prefer 4p)
 *       SPECTATE=1 SPECTATE_SERVER=USA npm run test:e2e -- spectate
 *       SPECTATE=1 SPECTATE_MINUTES=45 npm run test:e2e -- spectate
 *       SPECTATE=1 SPECTATE_SEATS=2 ...                   (target a 2-player game)
 *
 *  It SKIPS itself unless SPECTATE=1 (so the normal e2e run isn't held hostage to
 *  a live game) and skips if the gateway isn't reachable. It does NOT join or
 *  affect the game — pure spectator.
 * ===========================================================================
 */

const SPECTATE = !!process.env.SPECTATE
const BASE_URL = process.env.SPECTATE_BASE_URL || '' // '' = use the project baseURL (local :8090)
const SERVER = process.env.SPECTATE_SERVER || 'Beta' // a chip label in the connect screen
const WATCH_MINUTES = Number(process.env.SPECTATE_MINUTES || 30)
const PREFER_SEATS = Number(process.env.SPECTATE_SEATS || 4) // prefer a game with this many players
const POLL_MS = 4000
const STALL_WARN_MS = 180_000 // warn if nothing in the game changes for this long

type PlayerState = { name: string; life: number; hand: number | null; lib: number | null; grave: number | null; active: boolean }
type Snap = {
  turn: number | null
  active: string | null
  players: PlayerState[]
  stack: number
  combat: number
  boardUp: boolean
  over: boolean
  winner: string
  reconnecting: boolean
}

let gatewayUp = false
test.beforeAll(async ({ request }) => {
  try {
    gatewayUp = (await request.get('http://localhost:8090/', { timeout: 4000 })).ok()
  } catch {
    gatewayUp = false
  }
})

/** Scrape the whole observable game state from the DOM in one pass. */
async function readState(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const txt = (el: Element | null) => (el?.textContent || '').trim()
    const turnLabel = txt(document.querySelector('.turn-label'))
    const tm = turnLabel.match(/T(\d+)/)
    const am = turnLabel.match(/·\s*(.+)$/)
    const players = Array.from(document.querySelectorAll('.pstat')).map((p) => {
      const counts = txt(p.querySelector('.pstat-counts'))
      const num = (re: RegExp) => {
        const m = counts.match(re)
        return m ? parseInt(m[1], 10) : null
      }
      return {
        name: txt(p.querySelector('.pstat-name')),
        life: parseInt(txt(p.querySelector('.pstat-life')), 10),
        hand: num(/Hand\s+(\d+)/),
        lib: num(/Lib\s+(\d+)/),
        grave: num(/Grave\s+(\d+)/),
        active: p.classList.contains('active'),
      }
    })
    const panelN = (sel: string) => {
      const m = txt(document.querySelector(sel)).match(/\((\d+)\)/)
      return m ? parseInt(m[1], 10) : 0
    }
    return {
      turn: tm ? parseInt(tm[1], 10) : null,
      active: am ? am[1].trim() : null,
      players,
      stack: panelN('.stack-panel .stack-title'),
      combat: panelN('.combat-panel .stack-title'),
      boardUp: !!document.querySelector('.board3d canvas'),
      over: !!document.querySelector('.game-over-overlay'),
      winner: txt(document.querySelector('.game-over-msg')),
      reconnecting: !!document.querySelector('.reconnect-banner'),
    }
  })
}

/** A running, watchable game in the lobby table, with its row index + seat count. */
async function findGames(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.data-table tbody tr'))
      .map((tr, idx) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
        const watchable = Array.from(tr.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === 'Watch')
        const seatM = (cells[3] || '').match(/(\d+)\s*\/\s*(\d+)/)
        return { idx, name: cells[0], gameType: cells[1], seats: cells[3], state: cells[4], watchable, players: seatM ? Number(seatM[2]) : 0 }
      })
      .filter((g) => g.watchable),
  )
}

test('spectate a live game and verify invariants while it plays', async ({ page }) => {
  test.skip(!SPECTATE, 'opt-in: set SPECTATE=1 to run the live spectator (it watches a real game for minutes)')
  test.skip(!BASE_URL && !gatewayUp, 'gateway not reachable on :8090 — start it with scripts/run-gateway.sh (or set SPECTATE_BASE_URL)')
  test.setTimeout((WATCH_MINUTES + 5) * 60_000)

  // collect runtime errors the whole time — a crash is a hard failure
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  try {
    writeFileSync(LIVE_LOG, `# xmage spectator — ${new Date().toISOString()}\n`)
  } catch {
    /* best-effort */
  }

  // ----- connect to the real server as a throwaway spectator -----
  await page.addInitScript(() => localStorage.removeItem('mage.session'))
  await page.goto(BASE_URL || '/')
  await page.getByRole('button', { name: SERVER, exact: true }).click()
  const username = 'Spectator_' + Math.random().toString(36).slice(2, 8)
  await page.getByPlaceholder(/Any name/).fill(username)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('heading', { name: 'Open tables' })).toBeVisible({ timeout: 30_000 })
  live(`\n🔭 connected to ${SERVER} as ${username}`)

  // ----- find a running game (prefer the requested seat count) -----
  let chosen: Awaited<ReturnType<typeof findGames>>[number] | null = null
  const findDeadline = Date.now() + 3 * 60_000
  while (!chosen && Date.now() < findDeadline) {
    await page.getByRole('button', { name: /Refresh/ }).click().catch(() => {})
    await page.waitForTimeout(1500)
    const games = await findGames(page)
    if (games.length) {
      games.sort((a, b) => Math.abs(a.players - PREFER_SEATS) - Math.abs(b.players - PREFER_SEATS) || b.players - a.players)
      chosen = games[0]
    } else {
      live('… no watchable game yet, refreshing')
      await page.waitForTimeout(6000)
    }
  }
  test.skip(!chosen, 'no running game found to spectate within 3 minutes (inconclusive, not a failure)')
  live(`▶️  watching "${chosen!.name}" — ${chosen!.gameType}, ${chosen!.players} players (${chosen!.seats}), ${chosen!.state}`)

  await page.locator('.data-table tbody tr').nth(chosen!.idx).getByRole('button', { name: 'Watch' }).click()
  await expect(page.locator('.board3d canvas')).toBeVisible({ timeout: 30_000 })

  // ----- spectate + verify loop -----
  const fail: string[] = []
  const warn = new Set<string>()
  let snaps = 0
  let prev: Snap | null = null
  let lastChange = Date.now()
  let negativeSince: number | null = null
  const start = Date.now()
  const endAt = start + WATCH_MINUTES * 60_000
  const elapsed = () => {
    const s = Math.floor((Date.now() - start) / 1000)
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }
  const seenNames = new Set<string>()

  while (Date.now() < endAt) {
    const s = await readState(page).catch(() => null)
    if (!s) {
      await page.waitForTimeout(POLL_MS)
      continue
    }
    snaps++

    // --- hard invariants ---
    if (!s.boardUp && !s.over) fail.push(`[${elapsed()}] board canvas vanished mid-game`)
    if (prev && prev.turn != null && s.turn != null && s.turn < prev.turn)
      fail.push(`[${elapsed()}] turn went backwards: ${prev.turn} → ${s.turn}`)
    for (const p of s.players) {
      if (!Number.isFinite(p.life)) fail.push(`[${elapsed()}] ${p.name} has non-numeric life`)
      for (const [z, v] of [['hand', p.hand], ['lib', p.lib], ['grave', p.grave]] as const)
        if (v != null && v < 0) fail.push(`[${elapsed()}] ${p.name} has negative ${z} (${v})`)
      seenNames.add(p.name)
    }

    // --- soft checks (warnings) ---
    if (s.players.length < 2) warn.add('fewer than 2 players visible')
    if (s.active && s.players.length && !s.players.some((p) => p.name === s.active))
      warn.add(`active player "${s.active}" not in the player strip`)
    if (prev) {
      for (const p of s.players) {
        const before = prev.players.find((q) => q.name === p.name)
        if (before && Number.isFinite(p.life) && Number.isFinite(before.life) && Math.abs(p.life - before.life) > 60)
          warn.add(`large life swing for ${p.name}: ${before.life} → ${p.life}`)
        if (before && p.lib != null && before.lib != null && p.lib > before.lib + 5)
          warn.add(`${p.name}'s library grew unexpectedly: ${before.lib} → ${p.lib}`)
      }
    }
    const anyNeg = s.players.some((p) => Number.isFinite(p.life) && p.life < 0)
    if (anyNeg && !s.over) {
      negativeSince = negativeSince ?? Date.now()
      if (Date.now() - negativeSince > 20_000) warn.add('a player has been at negative life for >20s without the game ending')
    } else {
      negativeSince = null
    }
    if (s.reconnecting) warn.add('reconnect banner appeared (connection wobble)')

    // progress detection
    const sig = JSON.stringify([s.turn, s.active, s.stack, s.combat, s.players.map((p) => [p.name, p.life, p.hand, p.lib, p.grave])])
    const prevSig = prev ? JSON.stringify([prev.turn, prev.active, prev.stack, prev.combat, prev.players.map((p) => [p.name, p.life, p.hand, p.lib, p.grave])]) : null
    if (sig !== prevSig) lastChange = Date.now()
    else if (Date.now() - lastChange > STALL_WARN_MS && !s.over) warn.add(`no observable change for ${Math.round((Date.now() - lastChange) / 1000)}s (possibly stalled or a long think)`)

    // live line
    const strip = s.players.map((p) => `${p.active ? '▶' : ' '}${p.name} ${p.life}❤`).join('  ')
    live(`[${elapsed()}] T${s.turn ?? '?'} stack ${s.stack} combat ${s.combat} | ${strip}`)

    if (s.over) {
      live(`\n🏁 game over — ${s.winner}`)
      prev = s
      break
    }
    prev = s
    await page.waitForTimeout(POLL_MS)
  }

  if (pageErrors.length) fail.push(`uncaught page errors: ${pageErrors.slice(0, 5).join(' | ')}`)

  // ----- report -----
  live('\n────────── spectator report ──────────')
  live(`snapshots: ${snaps} over ${elapsed()}  ·  players seen: ${[...seenNames].join(', ') || '—'}`)
  live(`final: ${prev?.over ? `ENDED (${prev.winner})` : 'still running when watch ended'}`)
  if (consoleErrors.length) live(`console errors (informational): ${consoleErrors.length}`)
  if (warn.size) {
    live(`\n⚠️  warnings (${warn.size}):`)
    for (const w of warn) live(`   • ${w}`)
  } else {
    live('\n✅ no warnings')
  }
  if (fail.length) {
    live(`\n❌ invariant violations (${fail.length}):`)
    for (const f of fail) live(`   • ${f}`)
  } else {
    live('✅ no invariant violations')
  }
  live('──────────────────────────────────────\n')

  expect(snaps, 'expected to observe at least a few game states').toBeGreaterThan(2)
  expect(fail, 'live game invariants must hold throughout').toEqual([])
})
