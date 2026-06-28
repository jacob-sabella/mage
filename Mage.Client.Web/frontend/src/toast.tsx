import { useEffect, useState } from 'react'

// Lightweight toast notifications. Anything can fire one via pushToast(); the
// <Toaster/> mounted once in App renders + auto-dismisses them. No context needed.
export type ToastKind = 'info' | 'success' | 'error'
interface Toast {
  id: number
  text: string
  kind: ToastKind
}
type Listener = (t: Toast) => void

let seq = 0
const listeners = new Set<Listener>()

export function pushToast(text: string, kind: ToastKind = 'info') {
  if (!text) return
  const t: Toast = { id: ++seq, text, kind }
  listeners.forEach((l) => l(t))
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    const l: Listener = (t) => {
      setToasts((cur) => [...cur.slice(-3), t]) // cap visible stack
      window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 4200)
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  if (!toasts.length) return null
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role="status"
          onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
