import type { CardInfoDto, ConnectResponse, DeckSaveResponse, TableDto } from './types'

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

export function connect(host: string, port: number, username: string): Promise<ConnectResponse> {
  return request<ConnectResponse>('/api/connect', {
    method: 'POST',
    body: JSON.stringify({ host, port, username }),
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
export function searchCards(query: string): Promise<CardInfoDto[]> {
  return request<CardInfoDto[]>(`/api/cards/search?q=${encodeURIComponent(query)}`)
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
  cards: { name: string; count: number }[]
  sideboard: { name: string; count: number }[]
}

export function loadDeck(path: string): Promise<DeckLoadResponse> {
  return request<DeckLoadResponse>(`/api/decks/load?path=${encodeURIComponent(path)}`)
}

export function createGameVsAi(token: string, deckPath: string): Promise<{ ok: boolean; tableId: string }> {
  return request<{ ok: boolean; tableId: string }>('/api/tables/create', {
    method: 'POST',
    body: JSON.stringify({ token, deckPath }),
  })
}
