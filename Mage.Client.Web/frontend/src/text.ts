// XMage server messages/log lines are HTML (e.g. "<font color='#ff0'>…</font>",
// "<b>Card</b>", "<br>"). The Swing client renders that; in the web UI we strip
// it to clean, readable plain text.
const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

export function plain(s?: string | null): string {
  if (!s) return ''
  return s
    .replace(/<br\s*\/?>/gi, ' ') // line breaks -> space
    .replace(/<[^>]+>/g, '') // drop all remaining tags
    .replace(/&#?\w+;/g, (m) => ENTITIES[m.toLowerCase()] ?? m) // decode common entities
    .replace(/\s+/g, ' ')
    .trim()
}
