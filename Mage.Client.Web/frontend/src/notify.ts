// Tab-title attention: when something needs the player (their turn, game over)
// while the tab is in the background, flash the document title so they notice in
// their tab bar. App resets it when the tab regains focus.
const BASE_TITLE = 'XMage'

/** Flash the tab title (only meaningful while the tab is hidden). */
export function flashTitle(text: string) {
  document.title = `● ${text} — ${BASE_TITLE}`
}

export function resetTitle() {
  document.title = BASE_TITLE
}

/** Flash only when the tab is backgrounded (foreground users get the toast). */
export function notifyIfHidden(text: string) {
  if (document.hidden) flashTitle(text)
}
