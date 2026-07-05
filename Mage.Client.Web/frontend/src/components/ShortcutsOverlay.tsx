import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type Shortcut = { keys: string; label: string }

/** The in-game keybinds — the single source of truth, shared by the full ?
 *  overlay and the pinnable side cheat-sheet (ShortcutHints). */
export const IN_GAME_SHORTCUTS: Shortcut[] = [
  { keys: 'F4', label: 'Skip to next turn' },
  { keys: 'F5', label: 'Skip to end step' },
  { keys: 'F6', label: 'Skip to next main phase' },
  { keys: 'F8', label: 'Skip until stack resolved' },
  { keys: 'F9', label: 'Skip until my next turn' },
  { keys: 'F11', label: 'Skip to end step before my turn' },
  { keys: 'F3', label: 'Cancel skips' },
  { keys: 'D', label: 'Done / confirm selection' },
  { keys: 'P / Space', label: 'Pass priority' },
  { keys: 'Ctrl+Z / ⌫', label: 'Undo last action (while you have priority)' },
  { keys: 'Y / N', label: 'Answer yes / no (Mulligan / Keep)' },
  { keys: 'H', label: 'Hide / show your hand' },
  { keys: '← / →', label: 'Move between hand cards' },
  { keys: 'Enter', label: 'Play the focused hand card' },
]

/** Keyboard shortcuts, shown by pressing `?` (or the floating help button). */
const GROUPS: { title: string; items: Shortcut[] }[] = [
  { title: 'In a game', items: IN_GAME_SHORTCUTS },
  {
    title: 'General',
    items: [
      { keys: '?', label: 'Toggle this help' },
      { keys: 'Esc', label: 'Close dialogs / exit maximized board' },
    ],
  },
]

/** A pinnable, translucent side reference of the in-game keybinds — so you don't
 *  have to open the full ? overlay every time. Collapses to a slim ⌨ tab; the
 *  open/closed choice is remembered across games. */
export function ShortcutHints() {
  const [open, setOpen] = useState(() => {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem('mage.hintsOpen') : null
    return s == null ? false : s === '1'
  })
  useEffect(() => {
    try {
      localStorage.setItem('mage.hintsOpen', open ? '1' : '0')
    } catch {
      /* private mode */
    }
  }, [open])

  if (!open) {
    return (
      <button className="hints-tab" onClick={() => setOpen(true)} title="Pin keyboard shortcuts" aria-label="Show keyboard shortcuts">
        ⌨
      </button>
    )
  }
  return (
    <aside className="shortcut-hints" aria-label="Keyboard shortcuts reference">
      <div className="hints-head">
        <span className="hints-title">⌨ Shortcuts</span>
        <button className="hints-collapse" onClick={() => setOpen(false)} title="Hide (still on the ⌨ tab)" aria-label="Hide shortcuts">
          ✕
        </button>
      </div>
      <ul className="hints-list">
        {IN_GAME_SHORTCUTS.map((s) => (
          <li key={s.keys}>
            <kbd className="kbd">{s.keys}</kbd>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h1">Keyboard shortcuts</h2>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="shortcuts-group">
            <div className="shortcuts-group-title muted">{g.title}</div>
            <ul className="shortcuts-list">
              {g.items.map((s) => (
                <li key={s.keys}>
                  <kbd className="kbd">{s.keys}</kbd>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
