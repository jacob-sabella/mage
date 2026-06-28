/**
 * Client-side card image cache.
 *
 * Fetches card images once and stores them as blob: URLs so subsequent hovers
 * skip network requests entirely. In-flight deduplication ensures concurrent
 * requests for the same URL share one fetch rather than racing.
 */

const blobUrls = new Map<string, string>()
const inFlight = new Map<string, Promise<string>>()

/**
 * Fetch `apiUrl` and cache it as a blob URL. Returns the blob URL when done.
 * Concurrent callers for the same URL share the same in-flight fetch.
 * Falls through to the original URL on error.
 */
export function preloadImage(apiUrl: string): Promise<string> {
  const cached = blobUrls.get(apiUrl)
  if (cached) return Promise.resolve(cached)

  const pending = inFlight.get(apiUrl)
  if (pending) return pending

  const p = fetch(apiUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
      return r.blob()
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      blobUrls.set(apiUrl, url)
      inFlight.delete(apiUrl)
      return url
    })
    .catch(() => {
      inFlight.delete(apiUrl)
      return apiUrl // fall back to the original URL
    })

  inFlight.set(apiUrl, p)
  return p
}

/** Returns the cached blob URL for `apiUrl`, or `apiUrl` itself if not yet cached. */
export function getCachedUrl(apiUrl: string): string {
  return blobUrls.get(apiUrl) ?? apiUrl
}
