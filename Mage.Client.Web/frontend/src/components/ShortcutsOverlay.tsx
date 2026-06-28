import { createPortal } from 'react-dom'

/** Keyboard shortcuts, shown by pressing `?` (or the floating help button). */
const GROUPS: { title: string; items: { keys: string; label: string }[] }[] = [
  {
    title: 'In a game',
    items: [
      { keys: 'F2', label: 'Next turn' },
      { keys: 'F4', label: 'End turn' },
      { keys: 'F9', label: 'Skip until my turn' },
      { keys: 'F10', label: 'Resolve / stop on next ability' },
      { keys: 'F6', label: 'Cancel skips' },
      { keys: 'D', label: 'Done / confirm selection' },
      { keys: 'P / Space', label: 'Pass priority' },
      { keys: 'Y / N', label: 'Answer yes / no' },
    ],
  },
  {
    title: 'General',
    items: [
      { keys: '?', label: 'Toggle this help' },
      { keys: 'Esc', label: 'Close dialogs' },
    ],
  },
]

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
