import { useEffect, useRef, useState } from 'react'
import { plain } from '../text'
import type { ChatLine } from '../types'

interface Props {
  lines: ChatLine[]
  log?: string[]
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

// one-tap friendly phrases — common in card-game clients for fast, polite banter
const QUICK_CHAT = ['Good game!', 'Well played', 'Hello!', 'Thinking…', 'Oops!', 'Nice!']

export function ChatPanel({ lines, log = [], onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<'chat' | 'log'>('chat')
  const scrollRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const hasLog = log.length > 0

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, tab])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, tab])

  // If the log goes away (left the game), fall back to chat.
  useEffect(() => {
    if (!hasLog && tab === 'log') setTab('chat')
  }, [hasLog, tab])

  function submit() {
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <aside className="panel chat-panel">
      <div className="chat-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          className={`chat-tab${tab === 'chat' ? ' active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        {hasLog && (
          <button
            role="tab"
            aria-selected={tab === 'log'}
            className={`chat-tab${tab === 'log' ? ' active' : ''}`}
            onClick={() => setTab('log')}
          >
            Game log
          </button>
        )}
      </div>

      {tab === 'log' ? (
        <div className="chat-messages chat-log" ref={logRef}>
          {log.length === 0 && <p className="muted chat-empty">No log yet.</p>}
          {log.map((l, i) => {
            // turn-separator sentinel injected by LobbyView when the turn advances
            const turn = l.startsWith('❖TURN❖') ? l.slice('❖TURN❖'.length) : null
            if (turn !== null) {
              return (
                <div className="game-log-turn" key={i}>
                  <span>Turn {turn}</span>
                </div>
              )
            }
            return (
              <div className="game-log-line" key={i}>
                {plain(l)}
              </div>
            )
          })}
        </div>
      ) : (
        <>
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
                  {plain(l.text)}
                </span>
              </div>
            ))}
          </div>
          <div className="quick-chat" role="group" aria-label="Quick messages">
            {QUICK_CHAT.map((q) => (
              <button key={q} className="quick-chat-btn" onClick={() => onSend(q)} title={`Send "${q}"`}>
                {q}
              </button>
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
        </>
      )}
    </aside>
  )
}
