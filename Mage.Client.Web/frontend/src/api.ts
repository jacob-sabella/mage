import type { ConnectResponse, TableDto } from './types'

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
