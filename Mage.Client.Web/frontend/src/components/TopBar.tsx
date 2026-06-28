import { useState } from 'react'
import { ReportProblemModal, type ReportKind } from './ReportProblemModal'
import { captureScreenshot } from '../reportState'

interface Props {
  online: boolean
  server?: string
  view: string
}

type PendingReport = { kind: ReportKind; screenshot: string | null }

export function TopBar({ online, server, view }: Props) {
  const [pendingReport, setPendingReport] = useState<PendingReport | null>(null)

  async function openReport(kind: ReportKind) {
    // Capture before the modal renders so it shows the actual page, not the dialog
    const screenshot = await captureScreenshot()
    setPendingReport({ kind, screenshot })
  }

  return (
    <header className="topbar">
      <span className="brand-dot" />
      <span className="brand-name">XMAGE</span>
      <span className="spacer" />
      <button className="btn ghost topbar-report" onClick={() => openReport('feature')}>
        Request feature
      </button>
      <button className="btn ghost topbar-report" onClick={() => openReport('bug')}>
        Report problem
      </button>
      {server && <span className="muted server-label">{server}</span>}
      <span className={`conn-pill ${online ? 'online' : 'offline'}`}>
        {online ? 'Online' : 'Offline'}
      </span>
      {pendingReport && (
        <ReportProblemModal
          view={view}
          kind={pendingReport.kind}
          screenshot={pendingReport.screenshot}
          onClose={() => setPendingReport(null)}
        />
      )}
    </header>
  )
}
