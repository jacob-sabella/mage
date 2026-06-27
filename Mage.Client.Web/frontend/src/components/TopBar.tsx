import { useState } from 'react'
import { ReportProblemModal, type ReportKind } from './ReportProblemModal'

interface Props {
  online: boolean
  server?: string
  view: string
}

export function TopBar({ online, server, view }: Props) {
  const [reportKind, setReportKind] = useState<ReportKind | null>(null)
  return (
    <header className="topbar">
      <span className="brand-dot" />
      <span className="brand-name">XMAGE</span>
      <span className="spacer" />
      <button className="btn ghost topbar-report" onClick={() => setReportKind('feature')}>
        Request feature
      </button>
      <button className="btn ghost topbar-report" onClick={() => setReportKind('bug')}>
        Report problem
      </button>
      {server && <span className="muted server-label">{server}</span>}
      <span className={`conn-pill ${online ? 'online' : 'offline'}`}>
        {online ? 'Online' : 'Offline'}
      </span>
      {reportKind && <ReportProblemModal view={view} kind={reportKind} onClose={() => setReportKind(null)} />}
    </header>
  )
}
