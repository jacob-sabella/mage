// Tiny Web-Audio sound cues for game events (no assets). Off until the user
// enables "Sound effects" in Settings. The AudioContext is created lazily and
// resumed on use, so it works after the user's first interaction.

let enabled = false
let ctx: AudioContext | null = null

export function setSoundEnabled(on: boolean) {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** A short sine tone, scheduled `start` seconds from now. */
function tone(freq: number, start: number, dur: number, gain = 0.07) {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime + start
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.03)
}

export type Cue = 'turn' | 'start' | 'win' | 'lose'

/** Play a short musical cue for a game event. No-op unless sound is enabled. */
export function playCue(cue: Cue) {
  if (!enabled) return
  switch (cue) {
    case 'turn': // gentle rising two-note "it's you"
      tone(660, 0, 0.16)
      tone(880, 0.09, 0.2)
      break
    case 'start':
      tone(523, 0, 0.14)
      tone(784, 0.11, 0.22)
      break
    case 'win': // triumphant arpeggio
      tone(659, 0, 0.16)
      tone(880, 0.12, 0.18)
      tone(1047, 0.26, 0.34)
      break
    case 'lose': // descending
      tone(392, 0, 0.22)
      tone(294, 0.17, 0.34)
      break
  }
}
