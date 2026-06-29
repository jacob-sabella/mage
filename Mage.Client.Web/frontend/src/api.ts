import type { CardInfoDto, ConnectResponse, DeckCardEntry, DeckSaveResponse, TableDto } from './types'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return body as T
}

export function connect(
  host: string,
  port: number,
  username: string,
  profile?: { avatarId?: number; flagName?: string },
): Promise<ConnectResponse> {
  return request<ConnectResponse>('/api/connect', {
    method: 'POST',
    body: JSON.stringify({ host, port, username, ...profile }),
  })
}

export function fetchTables(token: string): Promise<TableDto[]> {
  return request<TableDto[]>(`/api/tables?token=${encodeURIComponent(token)}`)
}

export function sendChat(token: string, message: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ token, message }),
  })
}

export function watchGame(token: string, gameId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/watch', {
    method: 'POST',
    body: JSON.stringify({ token, gameId }),
  })
}

export function joinTable(token: string, tableId: string, deckPath: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/join', {
    method: 'POST',
    body: JSON.stringify({ token, tableId, deckPath }),
  })
}

export type RespondKind = 'boolean' | 'uuid' | 'integer' | 'string' | 'action' | 'concede'

export function respond(
  token: string,
  gameId: string,
  kind: RespondKind,
  value?: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/game/respond', {
    method: 'POST',
    body: JSON.stringify({ token, gameId, kind, value: value ?? '' }),
  })
}

// Card search runs server-side against the engine's local card database; it
// does not need a session token.
export interface CardSearchFilters {
  colors?: string // any of WUBRGC
  type?: string // e.g. Creature
  cmc?: string // exact mana value
}

export function searchCards(query: string, filters: CardSearchFilters = {}): Promise<CardInfoDto[]> {
  const p = new URLSearchParams({ q: query })
  if (filters.colors) p.set('colors', filters.colors)
  if (filters.type) p.set('type', filters.type)
  if (filters.cmc) p.set('cmc', filters.cmc)
  return request<CardInfoDto[]>(`/api/cards/search?${p.toString()}`)
}

export function saveDeck(name: string, cards: string[], path?: string): Promise<DeckSaveResponse> {
  return request<DeckSaveResponse>('/api/decks/save', {
    method: 'POST',
    body: JSON.stringify({ name, cards, path: path ?? '' }),
  })
}

export async function disconnect(token: string): Promise<void> {
  try {
    await request('/api/disconnect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  } catch {
    /* best-effort */
  }
}

export interface DeckLoadResponse {
  name: string
  cards: DeckCardEntry[]
  sideboard: DeckCardEntry[]
}

export function loadDeck(path: string): Promise<DeckLoadResponse> {
  return request<DeckLoadResponse>(`/api/decks/load?path=${encodeURIComponent(path)}`)
}

export interface DeckImportResponse {
  name: string
  cards: DeckCardEntry[]
  sideboard: DeckCardEntry[]
  unresolved: string[]
}

/** Import a deck from pasted text and/or a public Moxfield deck URL. */
export function importDeck(input: { text?: string; moxfieldUrl?: string; name?: string }): Promise<DeckImportResponse> {
  return request<DeckImportResponse>('/api/decks/import', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export interface DeckUploadResponse {
  ok: boolean
  name: string
  path: string
}

/** Upload a .dck file to the server's deck dir (multipart; not JSON). */
export async function uploadDeck(file: File): Promise<DeckUploadResponse> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch('/api/decks/upload', { method: 'POST', body: form })
  let body: { error?: string } & Partial<DeckUploadResponse> = {}
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body as DeckUploadResponse
}

export function createGameVsAi(
  token: string,
  deckPath: string,
  opponents = 1,
): Promise<{ ok: boolean; tableId: string }> {
  return request<{ ok: boolean; tableId: string }>('/api/tables/create', {
    method: 'POST',
    body: JSON.stringify({ token, deckPath, opponents }),
  })
}

// Open a joinable PvP table (vs another human). Returns the tableId; the match
// starts once a second human sits down. The creator waits in the lobby meanwhile.
export function createGameVsHuman(
  token: string,
  deckPath: string,
): Promise<{ ok: boolean; tableId: string; vsHuman: boolean }> {
  return request<{ ok: boolean; tableId: string; vsHuman: boolean }>('/api/tables/create', {
    method: 'POST',
    body: JSON.stringify({ token, deckPath, vsHuman: true }),
  })
}

// Cancel an open table you created (e.g. a PvP table nobody has joined yet).
export function removeTable(token: string, tableId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/tables/remove', {
    method: 'POST',
    body: JSON.stringify({ token, tableId }),
  })
}

export interface GameTypeInfo {
  name: string
  minPlayers: number
  maxPlayers: number
  useRange: boolean
  useAttackOption: boolean
}

export function fetchGameTypes(token: string): Promise<GameTypeInfo[]> {
  return request<GameTypeInfo[]>(`/api/gametypes?token=${encodeURIComponent(token)}`)
}

// Full table configuration sent to /api/tables/create.
export interface TableConfig {
  deckPath: string
  gameName?: string
  gameType: string
  aiOpponents: number
  openSeats: number
  timeLimit?: string
  bufferTime?: string
  mulliganType?: string
  freeMulligans?: number
  skillLevel?: string
  range?: string
  attackOption?: string
  rated?: boolean
  spectatorsAllowed?: boolean
  rollbackAllowed?: boolean
  planeChase?: boolean
  password?: string
  quitRatio?: number
  minimumRating?: number
  winsNeeded?: number
  customStartLife?: number
  customStartHandSize?: number
}

// Create a fully-configured table. `started` is true when it began immediately
// (no open human seats); otherwise it's an open table awaiting players.
export function createTable(
  token: string,
  config: TableConfig,
): Promise<{ ok: boolean; tableId: string; started: boolean; openSeats: number }> {
  return request('/api/tables/create', {
    method: 'POST',
    body: JSON.stringify({ token, ...config }),
  })
}

// Owner starts a waiting table's match.
export function startTable(token: string, tableId: string): Promise<{ ok: boolean }> {
  return request('/api/tables/start', { method: 'POST', body: JSON.stringify({ token, tableId }) })
}

// Fill an open seat of a waiting table with an AI (using the given deck).
export function addAiToTable(token: string, tableId: string, deckPath: string): Promise<{ ok: boolean }> {
  return request('/api/tables/add-ai', { method: 'POST', body: JSON.stringify({ token, tableId, deckPath }) })
}

export function checkSession(token: string): Promise<{ ok: boolean; server: string }> {
  return request<{ ok: boolean; server: string }>(`/api/session?token=${encodeURIComponent(token)}`)
}

export interface MatchDto {
  name: string
  gameType: string
  players: string
  result: string
  replayAvailable: boolean
  endTime?: number | null
}

export function fetchMatches(token: string): Promise<MatchDto[]> {
  return request<MatchDto[]>(`/api/matches?token=${encodeURIComponent(token)}`)
}

export interface DeckListItem {
  name: string
  path: string
  category: string
}

export function listDecks(): Promise<DeckListItem[]> {
  return request<DeckListItem[]>('/api/decks/list')
}

export function createDraft(
  token: string,
  set: string,
  packs = 3,
  opponents = 3,
): Promise<{ ok: boolean; tableId: string }> {
  return request<{ ok: boolean; tableId: string }>('/api/draft/create', {
    method: 'POST',
    body: JSON.stringify({ token, set, packs, opponents }),
  })
}

export function draftPick(token: string, draftId: string, cardId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/draft/pick', {
    method: 'POST',
    body: JSON.stringify({ token, draftId, cardId }),
  })
}

export interface DraftDeckCard {
  name: string
  set: string
  num: string
  qty: number
}

export function submitDraftDeck(
  token: string,
  tableId: string,
  cards: DraftDeckCard[],
  basics: { plains: number; island: number; swamp: number; mountain: number; forest: number },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/draft/submit', {
    method: 'POST',
    body: JSON.stringify({ token, tableId, cards, basics }),
  })
}

export interface ReportContext {
  appVersion: string
  view: string
  url: string
  userAgent: string
}

export interface ReportExtras {
  origin?: string
  screenshot?: string | null // jpeg data URL of the screen at submit time
  gameState?: unknown | null // snapshot of the current game for triage context
}

/** File a bug/feature GitHub issue via the gateway (token stays server-side). */
export function reportProblem(
  title: string,
  body: string,
  kind: 'bug' | 'feature',
  context: ReportContext,
  extras: ReportExtras = {},
): Promise<{ ok: boolean; url: string; number: number }> {
  return request<{ ok: boolean; url: string; number: number }>('/api/report', {
    method: 'POST',
    body: JSON.stringify({ title, body, kind, context, ...extras }),
  })
}
