import { createPortal } from 'react-dom'

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const entries = __APP_CHANGELOG__

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal panel changelog-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="h1">Changelog</h2>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
            {__APP_COMMIT__}
          </span>
        </div>
        <div className="changelog-list">
          {entries.length === 0 ? (
            <p className="muted">No changelog available.</p>
          ) : (
            entries.map((e) => (
              <div className="changelog-entry" key={e.hash}>
                <span className="changelog-date">{e.date}</span>
                <span className="changelog-msg">{e.msg}</span>
                <span className="changelog-hash muted">{e.hash}</span>
              </div>
            ))
          )}
        </div>
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
