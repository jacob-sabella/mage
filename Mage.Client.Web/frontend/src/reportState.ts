/**
 * A module-level snapshot of "what's on screen right now", kept fresh by the app
 * and read by the Report-a-problem modal so every issue carries rich context
 * (game state + a screenshot) without threading props through the whole tree.
 */
export interface ReportSnapshot {
  // game context (null when not in a game)
  game: unknown | null
  prompt: unknown | null
  log: string[]
  interactive: boolean
}

export const reportState: { snapshot: ReportSnapshot | null } = { snapshot: null }

export function setReportSnapshot(s: ReportSnapshot | null) {
  reportState.snapshot = s
}

/**
 * Capture the current screen as a JPEG data URL via html2canvas (dynamically
 * imported so it never bloats first load). The WebGL canvases are rendered with
 * preserveDrawingBuffer so they appear in the capture. Best-effort: returns null
 * on any failure.
 */
export async function captureScreenshot(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#0a0118',
      scale: Math.min(1, 1400 / Math.max(1, window.innerWidth)), // cap output width
      logging: false,
      useCORS: true,
    })
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}
