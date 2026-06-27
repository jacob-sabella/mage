import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

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
  if (!preview) return null
  return (
    <div className="card-preview-layer">
      <img className="card-preview-img" src={preview.src} alt={preview.name} />
    </div>
  )
}
