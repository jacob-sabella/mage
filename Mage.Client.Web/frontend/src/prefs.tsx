import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export interface Prefs {
  cardImages: boolean // render real card art (vs text-only cards)
  avatarId: number // profile avatar sent to the server (UserData)
  flagName: string // profile flag/country (UserData)
}

const DEFAULTS: Prefs = { cardImages: true, avatarId: 0, flagName: '' }
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
