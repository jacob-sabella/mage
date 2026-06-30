import { useEffect } from 'react'

interface Props {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A small in-app confirmation modal — a polished replacement for window.confirm
 *  (which is jarring, unstyled, and blocks the event loop). Enter confirms, Esc
 *  cancels, clicking the backdrop cancels. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="confirm-card panel" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        {message && <div className="confirm-msg">{message}</div>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
