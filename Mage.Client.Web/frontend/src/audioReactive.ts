import { useEffect, useRef } from 'react'

/**
 * A module-level singleton the per-frame useFrame callbacks read directly.
 * NOT React state — mutated in place each animation frame so nothing re-renders.
 * (R3F renders <Canvas> children through its own reconciler, so a React context
 *  from outside the Canvas isn't visible inside it without a bridge; a plain
 *  shared object sidesteps that and avoids per-frame setState.)
 *   level: smoothed overall loudness 0..1
 *   bass:  smoothed low-band energy 0..1
 *   glow:  the active family's --glow-strength (keeps noir subtle, vapor punchy)
 */
export const audioLevel = { level: 0, bass: 0, glow: 1 }

function readGlow(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--glow-strength')
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 1
}

/**
 * When `enabled`, request the default audio input (mic) and drive `audioLevel`
 * from a Web Audio AnalyserNode each frame. Tears everything down on disable /
 * unmount. `onError` fires (e.g. permission denied) so the caller can flip the
 * pref back off. The effect re-runs only on `enabled`; onError is read via a ref
 * so a fresh callback identity never restarts the mic.
 */
export function useAudioReactive(enabled: boolean, onError?: (e: unknown) => void) {
  const errRef = useRef(onError)
  errRef.current = onError

  useEffect(() => {
    if (!enabled) {
      audioLevel.level = 0
      audioLevel.bass = 0
      return
    }
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let cancelled = false
    let frame = 0
    audioLevel.glow = readGlow()

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        ctx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        ctx.resume().catch(() => {})
        const src = ctx.createMediaStreamSource(s)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.6
        src.connect(analyser)
        const bins = new Uint8Array(analyser.frequencyBinCount) // 128 bins
        const bassEnd = 8 // low bins ≈ bass/kick energy

        const tick = () => {
          analyser.getByteFrequencyData(bins)
          let sum = 0
          for (let i = 0; i < bins.length; i++) sum += bins[i]
          const overall = sum / bins.length / 255 // 0..1
          let bsum = 0
          for (let i = 0; i < bassEnd; i++) bsum += bins[i]
          const bass = bsum / bassEnd / 255
          // asymmetric smoothing: snappy attack, soft release
          const smooth = (t: number, cur: number) => cur + (t - cur) * (t > cur ? 0.5 : 0.12)
          audioLevel.level = smooth(overall, audioLevel.level)
          audioLevel.bass = smooth(bass, audioLevel.bass)
          if ((frame++ & 31) === 0) audioLevel.glow = readGlow() // pick up theme changes cheaply
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch((e) => {
        if (!cancelled) errRef.current?.(e)
      })

    return () => {
      cancelled = true
      audioLevel.level = 0
      audioLevel.bass = 0
      if (raf) cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close().catch(() => {})
    }
  }, [enabled])
}
