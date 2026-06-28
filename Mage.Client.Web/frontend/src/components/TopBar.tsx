import { useState } from 'react'
import { ReportProblemModal, type ReportKind } from './ReportProblemModal'
import { ChangelogModal } from './ChangelogModal'
import { captureScreenshot } from '../reportState'

interface Props {
  online: boolean
  server?: string
  view: string
}

type PendingReport = { kind: ReportKind; screenshot: string | null }

export function TopBar({ online, server, view }: Props) {
  const [pendingReport, setPendingReport] = useState<PendingReport | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)

  async function openReport(kind: ReportKind) {
    // Capture before the modal renders so it shows the actual page, not the dialog
    const screenshot = await captureScreenshot()
    setPendingReport({ kind, screenshot })
  }

  return (
    <header className="topbar">
      <span className="brand-dot" />
      <span className="brand-name">XMAGE</span>
      <button
        className="btn ghost version-chip"
        onClick={() => setShowChangelog(true)}
        title="View changelog"
      >
        {__APP_COMMIT__}
      </button>
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
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
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
