import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { reportProblem } from '../api'
import { captureScreenshot, reportState } from '../reportState'
import { useEscapeClose } from '../useEscapeClose'

async function captureHidingElement(el: HTMLElement): Promise<string | null> {
  el.style.display = 'none'
  // Two animation frames so the browser paints without the element before html2canvas reads the DOM
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const shot = await captureScreenshot()
  el.style.display = ''
  return shot
}

export type ReportKind = 'bug' | 'feature'

const COPY: Record<ReportKind, { heading: string; blurb: string; titlePh: string; bodyPh: string; bodyLabel: string }> = {
  bug: {
    heading: 'Report a problem',
    blurb: 'Opens a public issue on GitHub. Page URL and browser are attached automatically.',
    titlePh: 'Short summary',
    bodyPh: 'Steps to reproduce, what you expected, what you saw…',
    bodyLabel: 'What happened?',
  },
  feature: {
    heading: 'Request a feature',
    blurb: 'Opens a public issue on GitHub describing your idea. Browser info is attached automatically.',
    titlePh: 'Short summary of the idea',
    bodyPh: 'What would you like to see, and why?',
    bodyLabel: 'Describe the feature',
  },
}

/**
 * "Report a problem" / "Request a feature" dialog: files a public GitHub issue
 * on the fork via the gateway (which holds the token server-side). Current
 * screen, page URL and the browser are auto-attached. Side-effectful — only
 * fires on submit.
 */
export function ReportProblemModal({
  view,
  kind = 'bug',
  screenshot: preCapture,
  onClose,
}: {
  view: string
  kind?: ReportKind
  screenshot?: string | null
  onClose: () => void
}) {
  useEscapeClose(onClose)
  const copy = COPY[kind]
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [issueUrl, setIssueUrl] = useState('')
  const [errMsg, setErrMsg] = useState('')
  // undefined = use preCapture/fallback; null = user removed; string = user uploaded or pre-captured
  const [activeScreenshot, setActiveScreenshot] = useState<string | null | undefined>(preCapture)
  const [isRetaking, setIsRetaking] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const retakeScreenshot = async () => {
    if (!backdropRef.current || isRetaking) return
    setIsRetaking(true)
    setCaptureError(null)
    const shot = await captureHidingElement(backdropRef.current)
    if (shot !== null) {
      setActiveScreenshot(shot)
    } else {
      setCaptureError('Capture failed — try again or upload an image.')
    }
    setIsRetaking(false)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCaptureError(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const result = evt.target?.result
      if (typeof result === 'string') setActiveScreenshot(result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const submit = async () => {
    if (!title.trim() || status === 'sending') return
    setStatus('sending')
    setErrMsg('')
    try {
      // Use active screenshot (pre-captured, user-uploaded, or null if removed);
      // fall back to capturing now only if no screenshot decision was made at all
      const screenshot = activeScreenshot !== undefined ? activeScreenshot : await captureScreenshot()
      const res = await reportProblem(
        title.trim(),
        body.trim(),
        kind,
        {
          appVersion: 'web',
          view,
          url: window.location.href,
          userAgent: navigator.userAgent,
        },
        { origin: window.location.origin, screenshot, gameState: reportState.snapshot },
      )
      setIssueUrl(res.url)
      setStatus('done')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Could not submit')
      setStatus('error')
    }
  }

  // portal to body so the topbar's backdrop-filter stacking context can't trap it
  return createPortal(
    <div ref={backdropRef} className="modal-backdrop" onClick={onClose}>
      <div className="modal panel report-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h1">{copy.heading}</h2>
        </div>

        {status === 'done' ? (
          <div className="report-done">
            <p>Thanks — your {kind === 'feature' ? 'request' : 'report'} was filed.</p>
            <a href={issueUrl} target="_blank" rel="noreferrer">
              View issue #{issueUrl.split('/').pop()}
            </a>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="subtitle">{copy.blurb}</p>
            <label className="setting-row setting-row-col">
              <strong>Title</strong>
              <input
                className="setting-input"
                value={title}
                placeholder={copy.titlePh}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label className="setting-row setting-row-col">
              <strong>{copy.bodyLabel}</strong>
              <textarea
                className="setting-input"
                rows={5}
                value={body}
                placeholder={copy.bodyPh}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="report-screenshot">
              {activeScreenshot ? (
                <div className="report-screenshot-preview">
                  <img src={activeScreenshot} alt="Screenshot to attach" className="report-screenshot-img" />
                  <div className="report-screenshot-row">
                    <span className="report-screenshot-label">Screenshot attached</span>
                    <button className="btn ghost small" onClick={retakeScreenshot} disabled={isRetaking}>
                      {isRetaking ? 'Capturing…' : 'Retake'}
                    </button>
                    <button className="btn ghost small" onClick={() => fileInputRef.current?.click()}>
                      Replace
                    </button>
                    <button className="btn ghost small" onClick={() => { setActiveScreenshot(null); setCaptureError(null) }}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="report-screenshot-empty">
                  <span className="report-screenshot-label">No screenshot</span>
                  <button className="btn ghost small" onClick={retakeScreenshot} disabled={isRetaking}>
                    {isRetaking ? 'Capturing…' : 'Capture page'}
                  </button>
                  <button className="btn ghost small" onClick={() => fileInputRef.current?.click()}>
                    Upload
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="report-screenshot-input"
                onChange={handleFileUpload}
              />
            </div>
            {captureError && <p className="form-error">{captureError}</p>}
            {status === 'error' && <p className="form-error">{errMsg}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose} disabled={status === 'sending'}>
                Cancel
              </button>
              <button className="btn primary" onClick={submit} disabled={!title.trim() || status === 'sending'}>
                {status === 'sending' ? 'Submitting…' : kind === 'feature' ? 'Submit request' : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
