import { useEffect, useRef, useState } from 'react'
import type { ChatLine } from '../types'

interface Props {
  lines: ChatLine[]
  onSend: (message: string) => void
}

// Map the server's MessageColor enum to theme colors.
const COLOR: Record<string, string> = {
  RED: '#e0555f',
  GREEN: '#4ec98a',
  BLUE: '#5b8cff',
  ORANGE: '#e7a14b',
  YELLOW: '#d9c45a',
}

export function ChatPanel({ lines, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  function submit() {
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <aside className="panel chat-panel">
      <div className="chat-header">Chat</div>
      <div className="chat-messages" ref={scrollRef}>
        {lines.length === 0 && <p className="muted chat-empty">No messages yet.</p>}
        {lines.map((l, i) => (
          <div className="chat-line" key={i}>
            {l.user && (
              <span className="chat-user" style={{ color: l.color ? COLOR[l.color] : undefined }}>
                {l.user}:{' '}
              </span>
            )}
            <span className="chat-text" style={!l.user && l.color ? { color: COLOR[l.color] } : undefined}>
              {l.text}
            </span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Message the room…"
        />
        <button className="btn primary" onClick={submit}>
          Send
        </button>
      </div>
    </aside>
  )
}
