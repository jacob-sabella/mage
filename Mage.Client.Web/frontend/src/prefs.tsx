import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeName = 'synthwave' | 'outrun' | 'cyber' | 'vapor' | 'mythic' | 'noir' | 'cutesy'
export const THEMES: { id: ThemeName; label: string; family: string }[] = [
  { id: 'synthwave', label: 'Synthwave', family: 'Vaporwave' },
  { id: 'outrun', label: 'Outrun', family: 'Vaporwave' },
  { id: 'cyber', label: 'Cyber', family: 'Vaporwave' },
  { id: 'vapor', label: 'Vapor', family: 'Vaporwave' },
  { id: 'mythic', label: 'Mythic', family: 'Worlds' },
  { id: 'noir', label: 'Noir', family: 'Worlds' },
  { id: 'cutesy', label: 'Cutesy', family: 'Worlds' },
]

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
  // apply the colour palette to the document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.theme)
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
