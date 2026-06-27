import { useState } from 'react'
import { connect } from '../api'
import type { Session } from '../types'

interface Props {
  onConnected: (session: Session) => void
}

export function LoginView({ onConnected }: Props) {
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('17171')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; kind: 'error' | 'ok' | '' }>({ text: '', kind: '' })

  async function handleConnect() {
    const portNum = parseInt(port.trim(), 10)
    if (!host.trim() || !username.trim()) {
      setStatus({ text: 'Server and display name are required.', kind: 'error' })
      return
    }
    if (Number.isNaN(portNum)) {
      setStatus({ text: 'Port must be a number.', kind: 'error' })
      return
    }

    setBusy(true)
    setStatus({ text: `Connecting to ${host.trim()}:${portNum} …`, kind: '' })
    try {
      const res = await connect(host.trim(), portNum, username.trim())
      onConnected({ token: res.token, server: res.server })
    } catch (e) {
      setStatus({ text: `Could not connect: ${(e as Error).message}`, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="view login-view">
      <div className="panel login-card">
        <h1 className="h1">Connect to a server</h1>
        <p className="subtitle">Play Magic against players and AI opponents.</p>

        <div className="field-row">
          <label className="field">
            <span className="field-label">SERVER</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host" />
          </label>
          <label className="field port">
            <span className="field-label">PORT</span>
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="Port" />
          </label>
        </div>

        <label className="field">
          <span className="field-label">DISPLAY NAME</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            placeholder="Your display name"
          />
        </label>

        <button className="btn primary block" disabled={busy} onClick={handleConnect}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {status.text && <p className={`status ${status.kind}`}>{status.text}</p>}
      </div>
    </section>
  )
}
