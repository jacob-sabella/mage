import { useEffect, useRef, useState } from 'react'
import type { ServerEvent } from './types'

export interface ServerEventsState {
  events: ServerEvent[]
  online: boolean
}

/**
 * Opens the gateway WebSocket for a session and streams server push events
 * (messages / game events relayed from the upstream XMage server).
 * `onEvent` fires for each frame so callers can react (e.g. refresh the lobby).
 */
export function useServerEvents(token: string | null, onEvent?: (e: ServerEvent) => void): ServerEventsState {
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [online, setOnline] = useState(false)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!token) return
    let closed = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
      ws.onopen = () => setOnline(true)
      ws.onclose = () => {
        setOnline(false)
        // auto-reconnect so a dropped socket doesn't strand the game/lobby
        if (!closed) {
          retry = setTimeout(connect, 1500)
        }
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerEvent
          if (msg.type === 'heartbeat') return // keepalive only — ignore
          setEvents((prev) => [...prev.slice(-99), msg])
          onEventRef.current?.(msg)
        } catch {
          /* ignore non-JSON frames */
        }
      }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [token])

  return { events, online }
}
