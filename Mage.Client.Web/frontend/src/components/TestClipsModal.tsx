import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeClose } from '../useEscapeClose'

interface Clip {
  title: string
  spec: string
  file: string
  ok: boolean
}

/** Secret test gallery: plays the per-test Playwright recordings packaged into
 *  the build (see scripts/build-clips.mjs). Opened by typing "clips". */
export function TestClipsModal({ onClose }: { onClose: () => void }) {
  useEscapeClose(onClose)
  const [clips, setClips] = useState<Clip[] | null>(null)
  const [sel, setSel] = useState<Clip | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/test-clips/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no manifest'))))
      .then((d: { clips: Clip[] }) => {
        if (!alive) return
        setClips(d.clips ?? [])
        setSel(d.clips?.[0] ?? null)
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  const groups = useMemo(() => {
    const m = new Map<string, Clip[]>()
    for (const c of clips ?? []) (m.get(c.spec) ?? m.set(c.spec, []).get(c.spec)!).push(c)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [clips])

  return createPortal(
    <div className="modal-backdrop clips-backdrop" onClick={onClose}>
      <div className="modal panel clips-modal" role="dialog" aria-label="Test gallery" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h1">Test gallery 🎬</h2>
          <span className="muted">{clips ? `${clips.length} recorded tests` : 'loading…'}</span>
        </div>
        {error ? (
          <p className="empty">
            No clips packaged in this build. Run <code>npm run clips</code> to record them.
          </p>
        ) : (
          <div className="clips-body">
            <div className="clips-list">
              {groups.map(([spec, items]) => (
                <div className="clips-group" key={spec}>
                  <div className="clips-group-title">{spec.replace(/\.spec\.ts$/, '')}</div>
                  {items.map((c) => (
                    <button
                      key={c.file}
                      className={`clips-item${sel?.file === c.file ? ' active' : ''}`}
                      onClick={() => setSel(c)}
                    >
                      <span className={`clips-dot${c.ok ? ' ok' : ' fail'}`} />
                      {c.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="clips-player">
              {sel ? (
                <>
                  <video key={sel.file} src={`/test-clips/${sel.file}`} controls autoPlay loop />
                  <div className="clips-caption">
                    {sel.title} <span className="muted">· {sel.spec}</span>
                  </div>
                </>
              ) : (
                <p className="muted">{clips ? 'Select a test to play it.' : ''}</p>
              )}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
