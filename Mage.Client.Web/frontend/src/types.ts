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
  // present on game / gameStart frames
  gameId?: string
  game?: GameState
  prompt?: Prompt | null
}

export interface PromptChoice {
  key: string
  label: string
}

export interface Prompt {
  kind: 'ask' | 'select' | 'target' | 'amount' | 'choice' | 'generic'
  message?: string | null
  canCancel: boolean
  min: number
  max: number
  choices: PromptChoice[]
  choiceKind?: 'string' | 'uuid'
  targets: string[]
}

export interface GameCard {
  id: string
  name: string
  set?: string | null
  num?: string | null
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
  manaPool?: string
  battlefield: GameCard[]
  graveyard: GameCard[]
  exile: GameCard[]
}

export interface GameState {
  turn: number
  phase?: string | null
  step?: string | null
  activePlayer?: string | null
  priorityPlayer?: string | null
  me?: string | null
  players: GamePlayer[]
  stack: GameCard[]
  canPlay: string[]
  myHand: GameCard[]
  combat: CombatGroup[]
}

export interface CombatGroup {
  attackers: string[]
  blockers: string[]
  defender?: string | null
  blocked: boolean
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

export interface CardInfoDto {
  name: string
  manaCost?: string | null
  colors?: string | null
  types: string[]
  set?: string | null
  rarity?: string | null
  manaValue: number
}

export interface DeckCardEntry {
  name: string
  count: number
  manaValue?: number
  colors?: string | null
  types?: string[]
  manaCost?: string | null
}

export interface DeckSaveResponse {
  ok: boolean
  path: string
}
