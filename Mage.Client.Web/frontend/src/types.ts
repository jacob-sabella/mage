export interface TableDto {
  id: string
  name: string
  gameType: string
  deckType: string
  controller: string
  seats: string
  state: string
  skillLevel: string
}

export interface ConnectResponse {
  token: string
  server: string
}

export interface ServerEvent {
  type: 'ready' | 'message' | 'error' | 'event' | 'chat' | string
  payload?: string
  // present on chat frames
  user?: string | null
  text?: string | null
  color?: string | null
  time?: number | null
  messageType?: string | null
}

export interface ChatLine {
  user?: string | null
  text: string
  color?: string | null
  time?: number | null
}

export interface Session {
  token: string
  server: string
}
