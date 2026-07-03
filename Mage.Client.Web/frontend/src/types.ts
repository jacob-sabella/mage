export interface TableDto {
  id: string
  name: string
  gameType: string
  deckType: string
  controller: string
  seats: string
  state: string
  skillLevel: string
  isTournament?: boolean
  // the table owner set a join password — joining prompts for it
  passwordProtected?: boolean
  games: string[]
}

/** Tournament standings + pairings (the web spectator's tournament panel). */
export interface TournamentDto {
  name: string
  type: string
  state: string
  runningInfo: string
  watchingAllowed: boolean
  // seconds left in the deck-construction phase (limited tournaments); null/absent otherwise
  constructionTimeLeft?: number | null
  players: { name: string; state: string; points: number; results: string; quit: boolean }[]
  rounds: { round: number; games: TournamentGame[] }[]
}
export interface TournamentGame {
  round: number
  gameId?: string | null
  tableId?: string | null // the sub-table — spectate via watch-table
  state: string
  result: string
  players: string
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
  // present on draft frames
  draftId?: string
  tournamentId?: string
  draft?: DraftState
  // present on the construct frame (post-draft deck building)
  tableId?: string
  // present on showTournament frames (answer to a tournament watch)
  pool?: DraftCard[]
  // present on the sideboard frame (between games of a match)
  main?: DraftCard[]
  side?: DraftCard[]
  limited?: boolean
  // present on userRequest frames (a server question with option buttons)
  title?: string | null
  message?: string | null
  relatedUserName?: string | null
  options?: UserRequestOption[]
  // present on draftUpdate frames (pack/pick position, top-level)
  boosterNum?: number
  cardNum?: number
  setNames?: string[]
}

/** One answer button of a `userRequest` frame — respond('action', action).
 *  A null action is a dismiss-only button (just closes the dialog). */
export interface UserRequestOption {
  label: string
  action: string | null
}

export interface DraftBasics {
  plains: number
  island: number
  swamp: number
  mountain: number
  forest: number
}

export interface DraftCard {
  id: string
  name: string
  set: string
  num: string
  colors?: string
}

export interface DraftState {
  booster: DraftCard[]
  picks: DraftCard[]
  timeout: number
  // pack/pick position + the drafted set names, when the server ships them
  boosterNum?: number
  cardNum?: number
  setNames?: string[]
}

export interface PromptChoice {
  key: string
  label: string
}

export interface Prompt {
  kind: 'ask' | 'select' | 'target' | 'amount' | 'choice' | 'pile' | 'multiAmount' | 'generic'
  message?: string | null
  canCancel: boolean
  min: number
  max: number
  choices: PromptChoice[]
  choiceKind?: 'string' | 'uuid'
  targets: string[]
  pile1?: GameCard[]
  pile2?: GameCard[]
  multi?: { label: string; min: number; max: number; def: number }[]
  // target prompts only: the concrete pickable cards when they are NOT on the
  // battlefield (graveyard/library/revealed picks — delve, flashback, tutors).
  // [] / absent = ordinary board targeting (no picker overlay).
  candidates?: GameCard[]
  // Zone enum name, lowercased — note 'exiled' (not 'exile'), plus
  // hand/graveyard/library/battlefield/stack/command. null when n/a.
  candidateZone?: string | null
}

/** A named counter (poison/energy/… on players; +1/+1, loyalty, charge… on permanents). */
export interface CounterDto {
  name: string
  count: number
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
  // Present only for stack abilities: the source card that generated the ability.
  sourceName?: string | null
  sourceSet?: string | null
  sourceNum?: string | null
  // For a spell/ability on the stack: ids it targets, + the battlefield source id
  // of an ability. Drives the board's source→target arrows.
  targets?: string[]
  sourceId?: string | null
  // soulbond partner permanent id — draws the green pair arrow
  pairedCard?: string | null
  // combat eligibility during declare attackers/blockers — an eligible
  // creature is clickable to toggle it into/out of combat
  canAttack?: boolean
  canBlock?: boolean
  // counters on this permanent (+1/+1, loyalty, charge, …); [] when absent
  counters?: CounterDto[]
  // ids of permanents attached TO this permanent, and the id this one is
  // attached to (null / absent when free-standing)
  attachments?: string[]
  attachedTo?: string | null
  faceDown?: boolean
  isToken?: boolean
  isCopy?: boolean
  // command-zone entries only: what kind of command object this is
  commandType?: 'commander' | 'emblem' | 'plane' | 'dungeon' | null
  // rules text lines — populated ONLY for emblem/plane/dungeon command-zone
  // entries (they have no card face, so they render as a text card)
  rules?: string[] | null
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
  // command zone (commanders, emblems, planes, dungeons); [] when empty
  command: GameCard[]
  // player counters (poison, energy, experience, …); [] when none
  counters: CounterDto[]
  // designations like Monarch / Initiative / City's Blessing; [] when none
  designations: string[]
  // match clock: seconds left on this player's priority timer; null/absent
  // when the match has no time limit. timerActive = the clock is running now.
  timeLeft?: number | null
  timerActive?: boolean
  // armed skip actions (PlayerAction enum names) — lights the skip buttons
  skips?: string[]
}

/** A named group of revealed / looked-at cards (one per reveal source).
 *  lookedAt entries may carry cards WITHOUT names — only id/set/num. */
export interface RevealedGroup {
  name: string
  cards: GameCard[]
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
  // special actions: either [] or exactly [{id:'special', name:'Special'}] —
  // responding {kind:'string', value:'special'} makes the server follow up
  // with a 'choice' prompt listing the concrete actions
  special: { id: string; name: string }[]
  revealed: RevealedGroup[]
  lookedAt: RevealedGroup[]
}

export interface CombatGroup {
  attackers: string[]
  blockers: string[]
  defender?: string | null
  // UUID of the defender: a player id, or the permanent id of a defending
  // planeswalker/battle — resolvable against the battlefield position map.
  defenderId?: string | null
  blocked: boolean
}

export interface ChatLine {
  user?: string | null
  text: string
  color?: string | null
  time?: number | null
  // server MessageType enum name (TALK, WHISPER_FROM, WHISPER_TO, USER_INFO, STATUS, GAME, …)
  messageType?: string | null
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
