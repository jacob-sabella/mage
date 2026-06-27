interface Props {
  online: boolean
  server?: string
}

export function TopBar({ online, server }: Props) {
  return (
    <header className="topbar">
      <span className="brand-dot" />
      <span className="brand-name">XMage</span>
      <span className="brand-accent">Neon Grid</span>
      <span className="spacer" />
      {server && <span className="muted server-label">{server}</span>}
      <span className={`conn-pill ${online ? 'online' : 'offline'}`}>
        {online ? 'Online' : 'Offline'}
      </span>
    </header>
  )
}
