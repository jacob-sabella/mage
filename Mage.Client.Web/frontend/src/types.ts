export interface TableDto {
  id: string
  name: string
  gameType: string
  deckType: string
  controller: string
  seats: string
  state: string
  skillLevel: string
  games: string[]
}

export interface ConnectResponse {
  token: string
  server: string
}

export interface ServerEvent {
  type: 'ready' | 'message' | 'error' | 'event' | 'chat' | 'game' | string
  payload?: string
  // present on chat frames
  user?: string | null
  text?: string | null
  color?: string | null
  time?: number | null
  messageType?: string | null
  // present on game frames
  gameId?: string
  game?: GameState
}

export interface GameCard {
  id: string
  name: string
  power?: string | null
  toughness?: string | null
  loyalty?: string | null
  manaCost?: string | null
  colors?: string | null
  types: string[]
  tapped: boolean
  damage: number
}

export interface GamePlayer {
  id: string
  name: string
  life: number
  libraryCount: number
  handCount: number
  graveyardCount: number
  active: boolean
  battlefield: GameCard[]
}

export interface GameState {
  turn: number
  phase?: string | null
  step?: string | null
  activePlayer?: string | null
  priorityPlayer?: string | null
  players: GamePlayer[]
  stack: GameCard[]
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
