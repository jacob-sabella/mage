import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCachedUrl, preloadImage } from './imageCache'

interface Preview {
  src: string
  name: string
}
interface Ctx {
  preview: Preview | null
  setPreview: (p: Preview | null) => void
}

const PreviewCtx = createContext<Ctx>({ preview: null, setPreview: () => {} })

export function CardPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const value = useMemo(() => ({ preview, setPreview }), [preview])
  return <PreviewCtx.Provider value={value}>{children}</PreviewCtx.Provider>
}

export function useCardPreview() {
  return useContext(PreviewCtx)
}

/** Fixed large preview of the hovered card. */
export function CardPreviewLayer() {
  const { preview } = useCardPreview()
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!preview) {
      setSrc(null)
      return
    }
    // Use the blob URL immediately if already cached, else fall back to the raw
    // URL so the image starts displaying right away while caching in background.
    setSrc(getCachedUrl(preview.src))
    let alive = true
    preloadImage(preview.src).then((url) => {
      if (alive) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [preview?.src])

  if (!preview || !src) return null
  return (
    <div className="card-preview-layer">
      <img className="card-preview-img" src={src} alt={preview.name} />
    </div>
  )
}
