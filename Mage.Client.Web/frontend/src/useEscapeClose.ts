import { useLayoutEffect } from 'react'

/** Close a modal/overlay when Escape is pressed (consistent across all dialogs).
 *  useLayoutEffect (not useEffect) so the listener is attached before the browser
 *  paints the modal — otherwise a very fast Escape right after open can land in
 *  the gap before the listener exists and be lost (a flaky-test source). */
export function useEscapeClose(onClose: () => void) {
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}
