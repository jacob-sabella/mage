import { useState } from 'react'
import { createPortal } from 'react-dom'
import { reportProblem } from '../api'

export type ReportKind = 'bug' | 'feature'

const COPY: Record<ReportKind, { heading: string; blurb: string; titlePh: string; bodyPh: string; bodyLabel: string }> = {
  bug: {
    heading: 'Report a problem',
    blurb: 'Opens a public issue on GitHub. Current screen, page URL and your browser are attached automatically.',
    titlePh: 'Short summary',
    bodyPh: 'Steps to reproduce, what you expected, what you saw…',
    bodyLabel: 'What happened?',
  },
  feature: {
    heading: 'Request a feature',
    blurb: 'Opens a public issue on GitHub describing your idea. Current screen and browser are attached automatically.',
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
  onClose,
}: {
  view: string
  kind?: ReportKind
  onClose: () => void
}) {
  const copy = COPY[kind]
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [issueUrl, setIssueUrl] = useState('')
  const [errMsg, setErrMsg] = useState('')

  const submit = async () => {
    if (!title.trim() || status === 'sending') return
    setStatus('sending')
    setErrMsg('')
    try {
      const res = await reportProblem(title.trim(), body.trim(), kind, {
        appVersion: 'web',
        view,
        url: window.location.href,
        userAgent: navigator.userAgent,
      })
      setIssueUrl(res.url)
      setStatus('done')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Could not submit')
      setStatus('error')
    }
  }

  // portal to body so the topbar's backdrop-filter stacking context can't trap it
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
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
