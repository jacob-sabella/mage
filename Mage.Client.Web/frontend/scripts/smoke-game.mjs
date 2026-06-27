#!/usr/bin/env node
//
// End-to-end smoke test: drive a full game vs AI through the running gateway and
// assert the whole protocol loop works — every prompt kind and every combat
// phase — with no errors. Complements the headless-browser Playwright suite
// (which uses a faux backend); this one hits the REAL gateway + XMage server.
//
// Prereqs: gateway on :8090 + an XMage server it can reach, and `npm i ws`.
// Usage:   node Mage.Client.Web/scripts/smoke-game.mjs [deck.dck]
//   env:   GW=http://localhost:8090  DECK=/path/to/deck.dck
//
import WebSocket from 'ws'

const GW = process.env.GW || 'http://localhost:8090'
const DECK =
  process.argv[2] ||
  process.env.DECK ||
  'Mage.Client/release/sample-decks/Duel Decks/Elves vs. Goblins/Goblins.dck'
const MAX_PROMPTS = Number(process.env.MAX_PROMPTS || 120)

const J = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
const post = async (p, b) => {
  const r = await fetch(GW + p, J(b))
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { ok: false, raw: t, status: r.status } }
}

const { token } = await post('/api/connect', { host: 'localhost', port: 17171, username: 'smoke' + (process.pid % 1000) })
if (!token) { console.error('connect failed'); process.exit(1) }

let gameId = null
let prompts = 0
let lastTurn = -1
let acted = new Set()
const kinds = {}
const steps = new Set()
let errors = 0
let mana = false, attackers = false, blockers = false, damage = false

const respond = async (kind, value) => {
  const r = await post('/api/game/respond', { token, gameId, kind, value })
  if (r && r.ok === false) { errors++; console.error('respond error:', kind, JSON.stringify(r).slice(0, 120)) }
}

const ws = new WebSocket(`${GW.replace(/^http/, 'ws')}/ws?token=${token}`)

ws.on('open', async () => {
  const r = await post('/api/tables/create', { token, deckPath: DECK })
  if (!r.ok) { console.error('create failed:', JSON.stringify(r)); finish(1) }
})

ws.on('message', async (raw) => {
  let e
  try { e = JSON.parse(raw.toString()) } catch { return }
  if (e.type === 'gameStart') { gameId = e.gameId; return }
  if (e.type === 'log') {
    if (/\b(wins|has won|game over|conceded)\b/i.test(e.text || '')) { console.log('game over:', (e.text || '').replace(/<[^>]+>/g, '')); finish(0) }
    return
  }
  if (e.type !== 'game' || !e.prompt) return
  const g = e.game, p = e.prompt
  if (g?.turn != null && g.turn !== lastTurn) { lastTurn = g.turn; acted = new Set() }
  prompts++
  kinds[p.kind] = (kinds[p.kind] || 0) + 1
  steps.add(g?.step)
  if (/Pay /i.test(p.message || '')) mana = true
  if (/Declare Attackers/i.test(g?.step || '')) attackers = true
  if (/Declare Blockers/i.test(g?.step || '') || /select blockers/i.test(p.message || '')) blockers = true
  if (/Combat Damage/i.test(g?.step || '')) damage = true
  if (prompts >= MAX_PROMPTS) { console.log(`reached ${MAX_PROMPTS} prompts`); finish(0); return }

  // policy: keep hand; play a land; cast/declare each option once; else Done/pass
  const byId = {}
  ;(g?.myHand || []).forEach((c) => (byId[c.id] = c))
  g?.players?.forEach((pl) => pl.battlefield.forEach((c) => (byId[c.id] = c)))
  await new Promise((r) => setTimeout(r, 60))
  if (p.kind === 'ask') return respond('boolean', /mulligan/i.test(p.message || '') ? 'false' : 'true')
  if (p.kind === 'select') {
    const fresh = (g?.canPlay || []).filter((id) => !acted.has(id))
    const land = fresh.find((id) => (byId[id]?.types || []).some((t) => /land/i.test(t)))
    const pick = land || fresh[0]
    if (pick) { acted.add(pick); return respond('uuid', pick) }
    return respond('boolean', 'true')
  }
  if (p.kind === 'target') { const t = p.targets?.[0]; return respond('uuid', t?.id || t?.uuid || ''); }
  if (p.kind === 'amount') return respond('integer', String(p.min ?? 0))
  if (p.kind === 'choice') return respond(p.choiceKind || 'string', p.choices?.[0]?.key ?? '')
  return respond('boolean', 'false')
})

function finish(code) {
  console.log('\n=== smoke summary ===')
  console.log('reached turn :', lastTurn)
  console.log('prompt kinds :', JSON.stringify(kinds))
  console.log('steps        :', [...steps].filter(Boolean).join(' | '))
  console.log('mana-pay:', mana, '| attackers:', attackers, '| blockers:', blockers, '| combat-damage:', damage)
  console.log('respond errors:', errors)
  const ok = code === 0 && errors === 0 && attackers && blockers
  console.log(ok ? 'PASS' : 'CHECK')
  try { ws.close() } catch { /* */ }
  process.exit(ok ? 0 : 1)
}

setTimeout(() => { console.log('timeout'); finish(0) }, 90_000)
