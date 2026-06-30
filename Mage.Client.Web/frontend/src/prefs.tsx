import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setSoundEnabled } from './sound'

// A FAMILY is a base "world": its own backdrop (3D environment), fonts and vibe.
// A CHROMA is a colour variant painted on that base — same world, new accents.
// Chroma palettes live here in JS (not CSS) so adding variants is trivial: the
// family's neutral colours/fonts come from [data-family] CSS, and each chroma
// only supplies accent colours, applied as CSS variables at runtime.
export type BackdropKind = 'vapor' | 'mythic' | 'noir' | 'cutesy' | 'space'
export type FamilyId = 'vaporwave' | 'mythic' | 'noir' | 'cutesy' | 'space'
export type ThemeName = string

export interface Chroma {
  id: string
  label: string
  a: string // accent
  b: string // accent-2
  bg: string // deep background (3D board canvas / fog)
  surface: string // raised surface (3D board table)
}
export interface Family {
  id: FamilyId
  label: string
  backdrop: BackdropKind
  blurb: string
  chromas: Chroma[]
}

export const FAMILIES: Family[] = [
  {
    id: 'vaporwave', label: 'Vaporwave', backdrop: 'vapor',
    blurb: 'Neon grid · chrome horizon · retro sun',
    chromas: [
      { id: 'synthwave',  label: 'Synthwave',  a: '#ff2e97', b: '#21e6ff', bg: '#0a0118', surface: '#1f1142' },
      { id: 'outrun',     label: 'Outrun',     a: '#ff7a18', b: '#af4bff', bg: '#120516', surface: '#2a0f33' },
      { id: 'cyber',      label: 'Cyber',      a: '#39ff9e', b: '#00e5ff', bg: '#03120f', surface: '#082a22' },
      { id: 'vapor',      label: 'Vapor',      a: '#ff6ad5', b: '#26d9c3', bg: '#0e0820', surface: '#221546' },
      { id: 'sunset',     label: 'Sunset',     a: '#ff5e62', b: '#ffb347', bg: '#0e0604', surface: '#261408' },
      { id: 'miami',      label: 'Miami',      a: '#00e0c0', b: '#ff5db1', bg: '#020d0c', surface: '#0a2422' },
      { id: 'vhs',        label: 'VHS',        a: '#b14bff', b: '#4bd6ff', bg: '#080518', surface: '#1a1234' },
      { id: 'laser',      label: 'Laser',      a: '#ff1f6b', b: '#ffe14b', bg: '#0e0410', surface: '#26102c' },
      { id: 'hologram',   label: 'Hologram',   a: '#80e8ff', b: '#e880ff', bg: '#030610', surface: '#0e1628' },
    ],
  },
  {
    id: 'mythic', label: 'Mythic', backdrop: 'mythic',
    blurb: 'Candlelit hall · ember drift · ancient stone',
    chromas: [
      { id: 'mythic',         label: 'Gold',    a: '#e8c35a', b: '#4fbf86', bg: '#0c0a06', surface: '#211a0f' },
      { id: 'mythic-verdant', label: 'Verdant', a: '#6fd49a', b: '#e8c35a', bg: '#06100a', surface: '#12241a' },
      { id: 'mythic-crimson', label: 'Crimson', a: '#e0563a', b: '#e8c35a', bg: '#0e0504', surface: '#2a1008' },
      { id: 'mythic-azure',   label: 'Azure',   a: '#5a9fe8', b: '#e8c35a', bg: '#060a10', surface: '#141e30' },
      { id: 'mythic-royal',   label: 'Royal',   a: '#b48ce8', b: '#e8c35a', bg: '#07040e', surface: '#18122c' },
      { id: 'mythic-silver',  label: 'Silver',  a: '#c0d0e8', b: '#e8d4a0', bg: '#080a0e', surface: '#181e2a' },
    ],
  },
  {
    id: 'noir', label: 'Noir', backdrop: 'noir',
    blurb: 'Rain-slicked streets · searchlight · cigarette smoke',
    chromas: [
      { id: 'noir',         label: 'Classic', a: '#e23c3c', b: '#c9ccd2', bg: '#050506', surface: '#16181c' },
      { id: 'noir-sepia',   label: 'Sepia',   a: '#d9a441', b: '#e8dcc4', bg: '#0c0a07', surface: '#1f1a12' },
      { id: 'noir-ice',     label: 'Ice',     a: '#5ab0e8', b: '#c9ccd2', bg: '#040608', surface: '#101820' },
      { id: 'noir-emerald', label: 'Emerald', a: '#3fbf86', b: '#c9ccd2', bg: '#040608', surface: '#0e1812' },
      { id: 'noir-violet',  label: 'Violet',  a: '#b06cd6', b: '#c9ccd2', bg: '#050408', surface: '#14101c' },
    ],
  },
  {
    id: 'cutesy', label: 'Cutesy', backdrop: 'cutesy',
    blurb: 'Floating bubbles · cartoon sparkles · soft pastels',
    chromas: [
      { id: 'cutesy',          label: 'Bubblegum', a: '#ff9ed2', b: '#9be8d8', bg: '#2a1430', surface: '#4a2658' },
      { id: 'cutesy-mint',     label: 'Minty',     a: '#9be8d8', b: '#ffc6e6', bg: '#142a28', surface: '#265850' },
      { id: 'cutesy-lavender', label: 'Lavender',  a: '#c6a9ff', b: '#ffc6e6', bg: '#1a1028', surface: '#30244c' },
      { id: 'cutesy-peach',    label: 'Peach',     a: '#ffb38a', b: '#ffd6a0', bg: '#2a1612', surface: '#4e2c20' },
      { id: 'cutesy-sky',      label: 'Sky',       a: '#8ad0ff', b: '#ffc6e6', bg: '#0e1a2a', surface: '#1c3450' },
      { id: 'cutesy-candy',    label: 'Candy',     a: '#ff4d8c', b: '#ffcce0', bg: '#280d1a', surface: '#4c1c36' },
    ],
  },
  {
    id: 'space', label: 'Space', backdrop: 'space',
    blurb: 'Drifting planets · nebula dust · deep starfield',
    chromas: [
      { id: 'space-nebula',  label: 'Nebula',  a: '#b14bff', b: '#4bd6ff', bg: '#02030a', surface: '#0c1230' },
      { id: 'space-nova',    label: 'Nova',    a: '#2de2e6', b: '#ff5db1', bg: '#030608', surface: '#0c1820' },
      { id: 'space-mars',    label: 'Mars',    a: '#ff6a3d', b: '#ffb347', bg: '#0e0604', surface: '#261610' },
      { id: 'space-aurora',  label: 'Aurora',  a: '#5affc4', b: '#6b8cff', bg: '#030a06', surface: '#0c1e14' },
      { id: 'space-pulsar',  label: 'Pulsar',  a: '#6b8cff', b: '#ff5db1', bg: '#04030e', surface: '#10102a' },
      { id: 'space-quasar',  label: 'Quasar',  a: '#ffd23f', b: '#7b5bff', bg: '#080410', surface: '#1c1030' },
    ],
  },
]

export interface ChromaInfo extends Chroma {
  family: FamilyId
  backdrop: BackdropKind
}
/** flat chroma lookup by id */
export const CHROMAS: Record<string, ChromaInfo> = Object.fromEntries(
  FAMILIES.flatMap((f) => f.chromas.map((c) => [c.id, { ...c, family: f.id, backdrop: f.backdrop }])),
)
/** kept for older callers */
export const CHROMA_FAMILY = CHROMAS

export interface Prefs {
  cardImages: boolean // render real card art (vs text-only cards)
  avatarId: number // profile avatar sent to the server (UserData)
  flagName: string // profile flag/country (UserData)
  theme: ThemeName // colour palette
  manaIcons: boolean // render mana costs as symbols instead of {3}{B}{B} text
  panelOpacity: number // 0.35–1: how solid menus/panels are over the backdrop
  reduceMotion: boolean // lite mode: drop the animated 3D backdrop + UI motion
  sound: boolean // play short sound cues for game events (your turn, game over)
  handSize: 'small' | 'medium' | 'large' // size of the fixed hand fan at the bottom
  defaultCamera: 'auto' | '3d' | '2d' // desktop starting camera mode for the board
  boardZoom: number // 0.35–3.0: starting board zoom factor
}

const DEFAULTS: Prefs = { cardImages: true, avatarId: 0, flagName: '', theme: 'synthwave', manaIcons: true, panelOpacity: 0.72, reduceMotion: false, sound: false, handSize: 'medium', defaultCamera: 'auto', boardZoom: 0.75 }
const KEY = 'mage.prefs'

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return DEFAULTS
  }
}

interface PrefsCtx {
  prefs: Prefs
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void
  reset: () => void
}

const Ctx = createContext<PrefsCtx>({ prefs: DEFAULTS, setPref: () => {}, reset: () => {} })

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load)
  // apply the family (world/backdrop/fonts via CSS) + the chroma accents (via
  // inline CSS variables) to the document
  useEffect(() => {
    const c = CHROMAS[prefs.theme] ?? CHROMAS.synthwave
    const el = document.documentElement
    el.setAttribute('data-theme', prefs.theme)
    el.setAttribute('data-family', c.family)
    el.style.setProperty('--accent', c.a)
    el.style.setProperty('--accent-2', c.b)
    el.style.setProperty('--accent-press', c.a)
    el.style.setProperty('--grad-c', c.a)
    el.style.setProperty('--success', c.b)
  }, [prefs.theme])
  // panel translucency is independent of the chroma
  useEffect(() => {
    document.documentElement.style.setProperty('--panel-alpha', String(prefs.panelOpacity))
  }, [prefs.panelOpacity])
  // lite mode → a class CSS uses to disable DOM animations (the 3D backdrop is
  // gated separately in App)
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion)
  }, [prefs.reduceMotion])
  // hand-fan size → a documentElement attribute CSS keys off (no prop drilling)
  useEffect(() => {
    document.documentElement.setAttribute('data-hand-size', prefs.handSize)
  }, [prefs.handSize])
  useEffect(() => {
    setSoundEnabled(prefs.sound)
  }, [prefs.sound])
  const value = useMemo<PrefsCtx>(
    () => ({
      prefs,
      setPref: (key, val) =>
        setPrefs((p) => {
          const next = { ...p, [key]: val }
          localStorage.setItem(KEY, JSON.stringify(next))
          return next
        }),
      reset: () => {
        localStorage.setItem(KEY, JSON.stringify(DEFAULTS))
        setPrefs(DEFAULTS)
      },
    }),
    [prefs],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs() {
  return useContext(Ctx)
}
