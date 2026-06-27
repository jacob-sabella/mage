import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// A FAMILY is a base "world": its own backdrop (3D environment), fonts and vibe.
// A CHROMA is just a colour variant painted on that base — same world, new palette.
export type ThemeName =
  | 'synthwave' | 'outrun' | 'cyber' | 'vapor'
  | 'mythic' | 'mythic-verdant'
  | 'noir' | 'noir-sepia'
  | 'cutesy' | 'cutesy-mint'
export type BackdropKind = 'vapor' | 'mythic' | 'noir' | 'cutesy'
export type FamilyId = 'vaporwave' | 'mythic' | 'noir' | 'cutesy'

export interface Family {
  id: FamilyId
  label: string
  backdrop: BackdropKind
  blurb: string
  chromas: { id: ThemeName; label: string }[]
}

export const FAMILIES: Family[] = [
  {
    id: 'vaporwave', label: 'Vaporwave', backdrop: 'vapor', blurb: 'Neon grid, retro sun, stars',
    chromas: [
      { id: 'synthwave', label: 'Synthwave' },
      { id: 'outrun', label: 'Outrun' },
      { id: 'cyber', label: 'Cyber' },
      { id: 'vapor', label: 'Vapor' },
    ],
  },
  {
    id: 'mythic', label: 'Mythic', backdrop: 'mythic', blurb: 'Candlelit hall, drifting embers',
    chromas: [
      { id: 'mythic', label: 'Gold' },
      { id: 'mythic-verdant', label: 'Verdant' },
    ],
  },
  {
    id: 'noir', label: 'Noir', backdrop: 'noir', blurb: 'Rain, searchlight, monochrome',
    chromas: [
      { id: 'noir', label: 'Classic' },
      { id: 'noir-sepia', label: 'Sepia' },
    ],
  },
  {
    id: 'cutesy', label: 'Cutesy', backdrop: 'cutesy', blurb: 'Floating bubbles, soft pastels',
    chromas: [
      { id: 'cutesy', label: 'Bubblegum' },
      { id: 'cutesy-mint', label: 'Minty' },
    ],
  },
]

/** chroma id -> its family (and that family's backdrop). */
export const CHROMA_FAMILY: Record<string, { family: FamilyId; backdrop: BackdropKind }> =
  Object.fromEntries(
    FAMILIES.flatMap((f) => f.chromas.map((c) => [c.id, { family: f.id, backdrop: f.backdrop }])),
  )

// flat list kept for any old callers
export const THEMES = FAMILIES.flatMap((f) => f.chromas.map((c) => ({ ...c, family: f.label })))

export interface Prefs {
  cardImages: boolean // render real card art (vs text-only cards)
  avatarId: number // profile avatar sent to the server (UserData)
  flagName: string // profile flag/country (UserData)
  theme: ThemeName // colour palette
  manaIcons: boolean // render mana costs as symbols instead of {3}{B}{B} text
}

const DEFAULTS: Prefs = { cardImages: true, avatarId: 0, flagName: '', theme: 'synthwave', manaIcons: true }
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
}

const Ctx = createContext<PrefsCtx>({ prefs: DEFAULTS, setPref: () => {} })

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load)
  // apply the chroma (palette) + its family (world/backdrop/fonts) to the document
  useEffect(() => {
    const fam = CHROMA_FAMILY[prefs.theme]?.family ?? 'vaporwave'
    document.documentElement.setAttribute('data-theme', prefs.theme)
    document.documentElement.setAttribute('data-family', fam)
  }, [prefs.theme])
  const value = useMemo<PrefsCtx>(
    () => ({
      prefs,
      setPref: (key, val) =>
        setPrefs((p) => {
          const next = { ...p, [key]: val }
          localStorage.setItem(KEY, JSON.stringify(next))
          return next
        }),
    }),
    [prefs],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs() {
  return useContext(Ctx)
}
