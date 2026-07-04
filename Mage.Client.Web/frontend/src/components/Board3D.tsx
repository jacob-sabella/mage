import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Grid, Html, OrbitControls } from '@react-three/drei'
import { usePrefs, CHROMA_FAMILY } from '../prefs'
import { preloadImage } from '../imageCache'

// per-family in-game scene tint (background, fog, table, grid on/off)
const SCENE: Record<string, { bg: string; table: string; ring: string; ring2: string; grid: boolean; gridA: string; gridB: string; key: string; fill: string }> = {
  vapor:  { bg: '#0a0118', table: '#150a30', ring: '#ff2e97', ring2: '#21e6ff', grid: true,  gridA: '#7a2c9e', gridB: '#ff2e97', key: '#ff4fb0', fill: '#21e6ff' },
  mythic: { bg: '#0c0a06', table: '#1c160c', ring: '#e8c35a', ring2: '#4fbf86', grid: false, gridA: '#4a3a1e', gridB: '#e8c35a', key: '#ffd98a', fill: '#e8c35a' },
  noir:   { bg: '#050506', table: '#14161a', ring: '#e23c3c', ring2: '#c9ccd2', grid: false, gridA: '#2a2d33', gridB: '#5a5f66', key: '#dfe2e8', fill: '#9aa0aa' },
  cutesy: { bg: '#2a1430', table: '#3a1c45', ring: '#ff9ed2', ring2: '#9be8d8', grid: false, gridA: '#6b4080', gridB: '#ff9ed2', key: '#ffc6e6', fill: '#9be8d8' },
  space:  { bg: '#02030a', table: '#0a1024', ring: '#b14bff', ring2: '#4bd6ff', grid: false, gridA: '#1a2348', gridB: '#4bd6ff', key: '#cdd6ff', fill: '#6b8cff' },
}
import * as THREE from 'three'
import { FamilyBackdrop } from './backdrops'
import type { GameCard, GamePlayer, GameState } from '../types'

/** Parse a mana-cost string like "{2}{R}{R}" into symbol tokens. */
function manaSymbols(cost?: string | null): string[] {
  if (!cost) return []
  return (cost.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
}
const MANA_PIP: Record<string, string> = { W: '#e9e3c0', U: '#4a90e2', B: '#6b5b73', R: '#e0555f', G: '#3aa55f' }
const isType = (c: GameCard, re: RegExp) => (c.types ?? []).some((t) => re.test(t))

const CARD_W = 1.2
const CARD_H = 1.68
/** Max width (in local units) a battlefield row may span before cards start overlapping.
 *  Zone piles sit at x ≈ ±pileXFor(cardGap), which scales past the row width so
 *  battlefield rows never overflow into the zone piles. */
const MAX_ROW_W = 4.2
const MAX_PER_ROW = 12
/** X-position of the zone piles (library/GY on the right, exile on the left).
 *  Scales with the cardGap pref so widened battlefield rows never bury the piles;
 *  CARD_H/2 covers a tapped (90°-rotated) card at the row's end. */
function pileXFor(cardGap: number, cardScale = 1): number {
  return Math.max(3.9, (MAX_ROW_W * cardGap * cardScale) / 2 + (CARD_H * cardScale) / 2 + 0.45)
}
/** A card or a named land stack — same name lands collapse into one slot with a count.
 *  `members` carries the individual collapsed cards (only set for real stacks) so the
 *  card menu can tap a chosen number of the still-untapped ones. */
type RowItem = { card: GameCard; stackCount?: number; members?: GameCard[] }
const COLOR_BG: Record<string, string> = { W: '#cfc9a8', U: '#3b6ea5', B: '#3a3340', R: '#a53b3b', G: '#3a7a52' }

function bg(colors?: string | null) {
  if (!colors) return '#54596b'
  if (colors.length > 1) return '#9a7d34'
  return COLOR_BG[colors] ?? '#54596b'
}
function imgUrl(c: GameCard) {
  // an ability on the stack has no art of its own — fall back to its source card's
  // image (same as the hover preview) so it isn't a blank card
  const set = c.sourceSet ?? c.set
  const num = c.sourceNum ?? c.num
  const name = c.sourceName ?? c.name
  return `/api/cardimg?set=${encodeURIComponent(set ?? '')}&num=${encodeURIComponent(num ?? '')}&name=${encodeURIComponent(name)}`
}

/** Draw a readable card face on a canvas (name / type / P-T) so a card is never
 *  blank, even when its real art is missing. Real art replaces this once loaded. */
/** Objects with no printed card face (emblems/planes/dungeons, or anything
 *  without a set/number) render as text cards from their rules lines. */
function facelessCard(c: GameCard): boolean {
  return c.commandType === 'emblem' || c.commandType === 'plane' || c.commandType === 'dungeon' || (!c.set && !c.num)
}

function makeCardTexture(card: GameCard): THREE.Texture {
  const w = 256
  const h = 358
  const k = 2 // supersample so the text-only fallback stays crisp on the table
  const cv = document.createElement('canvas')
  cv.width = w * k
  cv.height = h * k
  const g = cv.getContext('2d')!
  g.scale(k, k)
  // clip all drawing to a rounded rect so corners are transparent
  g.beginPath()
  g.roundRect(0, 0, w, h, 28)
  g.clip()
  const base = bg(card.colors)
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  // darker art box + inset frame
  g.fillStyle = 'rgba(0,0,0,0.22)'
  g.fillRect(12, 54, w - 24, h - 120)
  g.strokeStyle = 'rgba(0,0,0,0.5)'
  g.lineWidth = 4
  g.strokeRect(8, 8, w - 16, h - 16)
  // name plate
  g.fillStyle = 'rgba(0,0,0,0.55)'
  g.fillRect(14, 14, w - 28, 36)
  const fit = (text: string, max: number) => {
    let s = text
    while (s.length > 4 && g.measureText(s).width > max) s = s.slice(0, -1)
    return s === text ? text : s.slice(0, -1) + '…'
  }
  g.fillStyle = '#f4f1e8'
  g.textBaseline = 'middle'
  // 28px so the name survives the downscale to on-table size
  g.font = 'bold 28px "Segoe UI", system-ui, sans-serif'
  // for a stack ability, name it after its source card, not the generic "Ability"
  g.fillText(fit(card.sourceName ?? card.name, w - 44), 22, 33)
  // emblems / planes / dungeons have no card face — render their rules text in
  // the art box so the card actually says what it does. (Every card ships rules
  // now, so "has rules" is NOT the faceless test — commandType/printing is.)
  if (facelessCard(card) && card.rules && card.rules.length) {
    g.fillStyle = '#e8e8ee'
    g.font = '14px "Segoe UI", system-ui, sans-serif'
    const maxW = w - 44
    let ry = 74
    outer: for (const rule of card.rules) {
      // simple word wrap inside the art box
      let line = ''
      for (const word of rule.split(/\s+/)) {
        const next = line ? line + ' ' + word : word
        if (g.measureText(next).width > maxW && line) {
          g.fillText(line, 22, ry)
          ry += 18
          if (ry > h - 80) break outer
          line = word
        } else {
          line = next
        }
      }
      if (line) {
        g.fillText(line, 22, ry)
        ry += 22
      }
      if (ry > h - 80) break
    }
  }
  // type line
  g.fillStyle = 'rgba(0,0,0,0.45)'
  g.fillRect(14, h - 64, w - 28, 28)
  g.fillStyle = '#e8e8ee'
  g.font = '15px "Segoe UI", system-ui, sans-serif'
  g.fillText(fit((card.types ?? []).join(' '), w - 70), 22, h - 49)
  // power/toughness or loyalty badge
  const badge = card.loyalty != null ? String(card.loyalty) : card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : ''
  if (badge) {
    g.fillStyle = 'rgba(0,0,0,0.75)'
    g.fillRect(w - 70, h - 66, 56, 32)
    g.fillStyle = '#fff'
    g.font = 'bold 19px "Segoe UI", system-ui, sans-serif'
    g.fillText(badge, w - 62, h - 49)
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** A generic face-down card back (for the library and pile depth layers). */
function makeCardBack(): THREE.Texture {
  const w = 256
  const h = 358
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  // clip all drawing to a rounded rect so corners are transparent
  g.beginPath()
  g.roundRect(0, 0, w, h, 28)
  g.clip()
  g.fillStyle = '#1a1430'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#2c2150'
  g.fillRect(12, 12, w - 24, h - 24)
  g.strokeStyle = '#b9933f'
  g.lineWidth = 6
  g.strokeRect(18, 18, w - 36, h - 36)
  g.save()
  g.translate(w / 2, h / 2)
  g.fillStyle = '#140e26'
  g.beginPath()
  g.ellipse(0, 0, w * 0.3, h * 0.27, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#b9933f'
  g.lineWidth = 4
  g.stroke()
  g.restore()
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Render a pill badge (P/T, loyalty, damage) to a canvas texture. In-canvas so
 *  it depth-occludes like real geometry — no DOM overlay bleeding over cards. */
function makeBadgeTexture(text: string, bg: string, fg: string, border: string): THREE.Texture {
  const k = 4 // supersample for crisp text
  const font = '800 30px "Segoe UI", system-ui, sans-serif'
  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = font
  const padX = 18
  const w = Math.ceil(meas.measureText(text).width) + padX * 2
  const h = 46
  const cv = document.createElement('canvas')
  cv.width = w * k
  cv.height = h * k
  const g = cv.getContext('2d')!
  g.scale(k, k)
  g.font = font
  g.fillStyle = bg
  g.beginPath()
  g.roundRect(1, 1, w - 2, h - 2, 12)
  g.fill()
  g.strokeStyle = border
  g.lineWidth = 2
  g.stroke()
  g.fillStyle = fg
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, w / 2, h / 2 + 1)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** A camera-facing badge sprite anchored in 3D. Depth-tested, so a card in front
 *  (stack card, hovered/lifted card, nearer row) hides it — unlike a DOM badge. */
function BadgeSprite({
  text,
  position,
  bg,
  fg = '#ffffff',
  border = 'rgba(255,255,255,0.28)',
  height = 0.5,
  cardId,
}: {
  text: string
  position: [number, number, number]
  bg: string
  fg?: string
  border?: string
  height?: number
  cardId: string
}) {
  const tex = useMemo(() => makeBadgeTexture(text, bg, fg, border), [text, bg, fg, border])
  useEffect(() => () => tex.dispose(), [tex])
  const img = tex.image as HTMLCanvasElement
  const aspect = img.width / img.height
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} userData={{ badgeCardId: cardId, badgeText: text }}>
      <spriteMaterial map={tex} transparent toneMapped={false} depthTest depthWrite={false} />
    </sprite>
  )
}

type CardProps = (c: GameCard) => { highlight?: 'play' | 'target'; onClick?: (c: GameCard) => void }

// counter pill colours for the common counter kinds; everything else gets a
// neutral slate pill
const COUNTER_BG: Record<string, string> = {
  '+1/+1': 'rgba(38,110,62,0.92)',
  '-1/-1': 'rgba(150,44,52,0.92)',
  charge: 'rgba(48,96,150,0.92)',
  loyalty: 'rgba(107,78,165,0.92)',
}

/** Which zone browsers a seat can open (public zones — the library stays hidden). */
export type BrowsableZone = 'graveyard' | 'exile' | 'command' | 'battlefield'

/** A stacked zone pile (library / graveyard / exile). Depth layers fake the
 *  stack height; the top card shows real art when the zone is public (face-up),
 *  or the card back when it's hidden (the library). A floating badge labels it. */
function CardPile({
  position,
  count,
  top,
  faceUp,
  label,
  cardProps,
  onHoverCard,
  occludeBadges,
  onOpen,
}: {
  position: [number, number] // local x, z
  count: number
  top?: GameCard | null
  faceUp: boolean
  label: string
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  occludeBadges?: boolean
  // open this zone's browser overlay (public zones only — the library stays
  // hidden). Clicking the pile opens it; the top card still goes through the
  // normal card-action path first (play / target beats browse).
  onOpen?: () => void
}) {
  const back = useMemo(makeCardBack, [])
  const { gl } = useThree()
  useEffect(() => {
    back.anisotropy = gl.capabilities.getMaxAnisotropy?.() ?? 8
    back.needsUpdate = true
    return () => back.dispose()
  }, [back, gl])

  // empty zone → a faint outlined slot so its position still reads
  const layers = Math.max(0, Math.min(count, 8))
  const step = 0.02
  const topY = Math.max(0, layers - 1) * step + 0.012

  // the top card's primary action (play / target) wins; otherwise a click on it
  // falls through to opening the zone browser
  const pileCardProps: CardProps = (c) => {
    const r = cardProps(c)
    if (r.onClick || !onOpen) return r
    return { ...r, onClick: () => onOpen() }
  }
  const openHandler = onOpen
    ? (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        onOpen()
      }
    : undefined

  return (
    <group position={[position[0], 0, position[1]]}>
      {count <= 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.05} />
        </mesh>
      )}
      {/* depth layers (face-down backs) under the top card — lean AWAY from the
          battlefield (exile sits at negative x, so it leans further left) */}
      {Array.from({ length: Math.max(0, layers - 1) }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[(position[0] < 0 ? -1 : 1) * 0.012 * i, 0.012 + i * step, 0.012 * i]} onClick={openHandler}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial map={back} toneMapped={false} transparent depthWrite={false} />
        </mesh>
      ))}
      {/* top of the pile */}
      {count > 0 &&
        (faceUp && top ? (
          <Card3D card={top} position={[0, topY, 0]} cardProps={pileCardProps} onHoverCard={onHoverCard} />
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY, 0]}>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial map={back} toneMapped={false} transparent depthWrite={false} />
          </mesh>
        ))}
      {/* label only when the pile has cards ("EXILE 0" over nothing reads as junk);
          no distanceFactor → constant screen-size, so an opponent's pill stays small
          but legible instead of shrinking into a garbled smear */}
      {count > 0 && (
        <Html
          position={[0, 0.34, CARD_H * 0.62]}
          center
          zIndexRange={[15, 0]}
          occlude={occludeBadges}
          className="c3d-badge c3d-zone"
          style={{ fontSize: '10px', padding: '1px 6px' }}
        >
          {label} {count}
        </Html>
      )}
    </group>
  )
}

/** A single card as a textured plane; lies flat (battlefield) or stands (hand/stack). */
function Card3D({
  card,
  position,
  standing,
  showCost,
  stackCount,
  members,
  rowGap,
  cardProps,
  onHoverCard,
  onOpenMenu,
  occludeBadges,
  worldScale,
}: {
  card: GameCard
  position: [number, number, number]
  standing?: boolean
  showCost?: boolean
  stackCount?: number
  members?: GameCard[]
  // effective world-space pitch of the row this card sits in — dense rows hide
  // the badge sprites (P/T is baked into the card texture) instead of rendering
  // an unreadable pile of overlapping pills
  rowGap?: number
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  onOpenMenu?: (c: GameCard, members?: GameCard[]) => void
  // only raycast-occlude the DOM badges when there's a central stack to hide them
  // behind — avoids per-frame badge flicker the rest of the time
  occludeBadges?: boolean
  // battlefield card-size pref: scales the whole card group about its position
  worldScale?: number
}) {
  const [art, setArt] = useState<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
  // touch long-press → preview (right-click does it on desktop); a quick tap plays
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const { highlight, onClick } = cardProps(card)
  const { gl } = useThree()
  const maxAniso = useMemo(() => gl.capabilities.getMaxAnisotropy?.() ?? 8, [gl])

  // face-down permanents (morphs, manifests) show the card back, not their face
  const faceDown = !!card.faceDown
  // always-present readable face; disposed on unmount. Face-down → the shared
  // card-back drawing instead of the (hidden) real face.
  const fallback = useMemo(
    () => (faceDown ? makeCardBack() : makeCardTexture(card)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card.id, card.name, card.power, card.toughness, card.loyalty, faceDown],
  )
  useEffect(() => {
    fallback.anisotropy = maxAniso // sharp at the board's viewing angle
    fallback.needsUpdate = true
    return () => fallback.dispose()
  }, [fallback, maxAniso])

  // try to upgrade to real card art (composited onto a canvas so it gets rounded corners)
  useEffect(() => {
    let alive = true
    // no art to fetch for a face-down card or a faceless text card (emblem/plane)
    if (faceDown || facelessCard(card)) {
      setArt(null)
      return
    }
    preloadImage(imgUrl(card))
      .then((src) => {
        if (!alive) return
        const img = new Image()
        img.onload = () => {
          if (!alive) return
          const cv = document.createElement('canvas')
          cv.width = img.naturalWidth
          cv.height = img.naturalHeight
          const g = cv.getContext('2d')!
          const r = (28 / 256) * cv.width
          g.beginPath()
          g.roundRect(0, 0, cv.width, cv.height, r)
          g.clip()
          g.drawImage(img, 0, 0)
          const t = new THREE.CanvasTexture(cv)
          t.colorSpace = THREE.SRGBColorSpace
          t.anisotropy = maxAniso
          t.minFilter = THREE.LinearMipmapLinearFilter
          t.magFilter = THREE.LinearFilter
          t.needsUpdate = true
          if (alive) setArt(t)
          else t.dispose()
        }
        img.onerror = () => { if (alive) setArt(null) }
        img.src = src
      })
      .catch(() => { if (alive) setArt(null) })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.name, maxAniso, faceDown])

  const tex = faceDown ? fallback : art ?? fallback

  // flat on table, rotated 90° when tapped; or standing toward camera
  const rot: [number, number, number] = standing
    ? [0, 0, 0]
    : [-Math.PI / 2, 0, card.tapped ? -Math.PI / 2 : 0]
  // a real hover enlarge — big enough to read the card in place. Safe now: the
  // invisible stable hit-mesh prevents the enter/leave feedback loop, and the
  // P/T badges are in-scene sprites the lifted card correctly occludes (the old
  // small pop predates both fixes).
  const lift = hover ? 0.5 : 0
  const scale = hover ? 1.4 : 1
  const glow = highlight === 'play' ? '#21e6ff' : highlight === 'target' ? '#ff2e97' : '#ffffff'
  // Fixed y for hit detection — does not move when card lifts on hover.
  // Keeping the interactive mesh stable prevents the feedback loop where lifting
  // moves the geometry out from under the pointer, firing onPointerLeave, dropping
  // the card, firing onPointerEnter again, etc. — which was flashing the preview.
  const hitY = standing ? CARD_H / 2 : 0.02

  return (
    <group position={position} scale={worldScale ?? 1}>
      {/* Invisible stable hit area: stays at the original y regardless of hover state.
          Pointer events are handled here; the visual content is a separate group. */}
      <mesh
        position={[0, hitY, 0]}
        rotation={rot}
        userData={{ cardId: card.id, faceDown, isToken: !!card.isToken, isCopy: !!card.isCopy }}
        onPointerEnter={(e) => {
          e.stopPropagation()
          setHover(true)
          onHoverCard?.(card)
        }}
        onPointerMove={(e) => {
          e.stopPropagation()
          onHoverCard?.(card)
        }}
        onPointerLeave={() => {
          setHover(false)
          onHoverCard?.(null)
          if (pressTimer.current) clearTimeout(pressTimer.current)
        }}
        onPointerDown={(e) => {
          // touch only: hold to open the card menu, quick tap falls through to onClick (play)
          if (e.pointerType !== 'touch') return
          longPressed.current = false
          pressTimer.current = setTimeout(() => {
            longPressed.current = true
            onOpenMenu?.(card, members)
          }, 450)
        }}
        onPointerUp={() => {
          if (pressTimer.current) clearTimeout(pressTimer.current)
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (pressTimer.current) clearTimeout(pressTimer.current)
          if (longPressed.current) {
            longPressed.current = false // a touch long-press previewed — don't also play
            return
          }
          onClick?.(card) // tap / left-click plays — preview never hijacks it
        }}
        onContextMenu={(e) => {
          // desktop: right-click opens the card menu (play / abilities / land-stack tap)
          e.stopPropagation()
          e.nativeEvent.preventDefault()
          onOpenMenu?.(card, members)
        }}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Visual group lifts and scales on hover independently of the hit area */}
      <group position={[0, lift, 0]}>
        {/* glowing backing plate for highlighted (playable/targetable) or hovered cards */}
        {(highlight || hover) && (
          <mesh
            position={[0, standing ? CARD_H / 2 : 0.012, standing ? -0.01 : 0]}
            rotation={rot}
            scale={scale}
            raycast={() => null}
          >
            <planeGeometry args={[CARD_W * 1.12, CARD_H * 1.1]} />
            <meshBasicMaterial color={glow} transparent opacity={hover ? 0.85 : 0.55} toneMapped={false} depthWrite={false} />
          </mesh>
        )}
        <mesh
          position={[0, standing ? CARD_H / 2 : 0.02, 0]}
          rotation={rot}
          scale={scale}
          raycast={() => null}
        >
          <planeGeometry args={[CARD_W, CARD_H]} />
          {/* unlit + toneMapped off → card art shows at full, vivid, readable colour
              instead of being washed out by the scene lighting. Tapped permanents are
              dimmed (in addition to the 90° rotation) so they read as "used" at a glance. */}
          {/* write depth (alphaTest drops the transparent rounded corners) so the
              in-canvas badge sprites are occluded by cards drawn in front of them */}
          {/* tokens get a subtle desaturating tint so they read as "not a real
              card" at a glance; the tapped dim wins when both apply */}
          <meshBasicMaterial map={tex} color={card.tapped && !standing ? '#7a7a82' : card.isToken ? '#d4d4da' : '#ffffff'} toneMapped={false} transparent alphaTest={0.5} depthWrite />
        </mesh>

        {/* creature P/T, damage, loyalty — in-canvas sprites so they occlude
            properly (a card in front hides them) instead of a DOM overlay on top.
            Hidden entirely on very dense rows (gap < 0.6: the pills would overlap
            ~50% into a garbled stack; P/T is already baked into the card texture),
            and scaled down as the row compresses below the comfortable pitch. */}
        {(() => {
          const showBadges = rowGap == null || rowGap >= 0.6
          const badgeScale = rowGap == null ? 1 : Math.min(1, rowGap / 0.9)
          if (!showBadges) return null
          return (
            <>
              {isType(card, /creature/i) && card.power != null && card.toughness != null && (
                <BadgeSprite
                  text={`${card.power}/${card.toughness}`}
                  position={[CARD_W * 0.34, 0.14, CARD_H * 0.3]}
                  bg="rgba(10,12,18,0.92)"
                  height={0.5 * badgeScale}
                  cardId={card.id}
                />
              )}
              {isType(card, /creature/i) && card.damage > 0 && (
                <BadgeSprite
                  text={`−${card.damage}`}
                  position={[CARD_W * 0.34, 0.14, -CARD_H * 0.04]}
                  bg="#e0344f"
                  height={0.3 * badgeScale}
                  cardId={card.id}
                />
              )}
              {isType(card, /planeswalker/i) && card.loyalty != null && (
                <BadgeSprite
                  text={String(card.loyalty)}
                  position={[CARD_W * 0.34, 0.14, CARD_H * 0.3]}
                  bg="#6b4ea5"
                  height={0.5 * badgeScale}
                  cardId={card.id}
                />
              )}
              {/* permanent counters (+1/+1, charge, …) as a pill column on the
                  card's left edge — same badge system as P/T so they occlude and
                  cull identically. Capped at 3 kinds + a "+n" overflow pill.
                  A planeswalker's loyalty counter is skipped: the loyalty badge
                  above already shows it. */}
              {(() => {
                const counters = (card.counters ?? []).filter(
                  (k) => k.count > 0 && !(card.loyalty != null && /^loyalty$/i.test(k.name)),
                )
                if (!counters.length) return null
                const shown = counters.slice(0, 3)
                const extra = counters.length - shown.length
                return (
                  <>
                    {shown.map((k, i) => (
                      <BadgeSprite
                        key={k.name}
                        text={`${k.name} ×${k.count}`}
                        position={[-CARD_W * 0.3, 0.14, CARD_H * 0.3 - i * 0.34]}
                        bg={COUNTER_BG[k.name.toLowerCase()] ?? 'rgba(38,42,54,0.92)'}
                        height={0.28 * badgeScale}
                        cardId={card.id}
                      />
                    ))}
                    {extra > 0 && (
                      <BadgeSprite
                        text={`+${extra}`}
                        position={[-CARD_W * 0.3, 0.14, CARD_H * 0.3 - shown.length * 0.34]}
                        bg="rgba(38,42,54,0.92)"
                        height={0.28 * badgeScale}
                        cardId={card.id}
                      />
                    )}
                  </>
                )
              })()}
              {/* a copied permanent wears a small COPY ribbon at its top edge */}
              {card.isCopy && (
                <BadgeSprite
                  text="COPY"
                  position={[0, 0.14, -CARD_H * 0.3]}
                  bg="rgba(38,88,140,0.92)"
                  height={0.24 * badgeScale}
                  cardId={card.id}
                />
              )}
            </>
          )
        })()}
        {showCost && manaSymbols(card.manaCost).length > 0 && (
          <Html
            position={[-CARD_W * 0.34, 0.16, -CARD_H * 0.44]}
            center
            distanceFactor={8}
            zIndexRange={[16, 0]}
            occlude={occludeBadges}
            className="c3d-badge c3d-mana"
          >
            {manaSymbols(card.manaCost).map((s, i) => (
              <span key={i} className="c3d-pip" style={{ background: MANA_PIP[s] ?? '#9aa0ad' }}>
                {s}
              </span>
            ))}
          </Html>
        )}
        {stackCount != null && stackCount > 1 && (
          <Html
            position={[-CARD_W * 0.3, 0.14, CARD_H * 0.3]}
            center
            distanceFactor={9}
            zIndexRange={[20, 0]}
            occlude={occludeBadges}
            className="c3d-badge c3d-stack"
          >
            ×{stackCount}
          </Html>
        )}
      </group>
    </group>
  )
}

/** Lay a row of cards/stacks centered at (cx, cz) along X.
 *  When the row would exceed MAX_ROW_W the gap shrinks so cards overlap
 *  (Slay-the-Spire style) instead of spilling outside the player's zone. */
function row(items: RowItem[], cx: number, cz: number, gap = 1.45, maxW = MAX_ROW_W) {
  const n = items.length
  if (n === 0) return []
  // Cap the gap so the total row width never exceeds maxW.
  const effectiveGap = n > 1 ? Math.min(gap, maxW / (n - 1)) : gap
  const w = (n - 1) * effectiveGap
  // Tiny per-card y stagger prevents coplanar z-fighting when adjacent cards share
  // edge pixels under MSAA — visually imperceptible at this scale.
  // `gap` = the effective (possibly compressed) pitch, so consumers can scale or
  // hide per-card overlays that would garble on a dense row.
  return items.map(({ card, stackCount, members }, i) => ({
    card,
    stackCount,
    members,
    gap: effectiveGap,
    pos: [cx - w / 2 + i * effectiveGap, i * 0.001, cz] as [number, number, number],
  }))
}

/** Group same-named lands into stacks (Arena-style), preserving first-seen order. */
function groupLands(lands: GameCard[]): RowItem[] {
  const map = new Map<string, { card: GameCard; members: GameCard[] }>()
  const order: string[] = []
  for (const c of lands) {
    if (map.has(c.name)) {
      map.get(c.name)!.members.push(c)
    } else {
      map.set(c.name, { card: c, members: [c] })
      order.push(c.name)
    }
  }
  return order.map((name) => {
    const { card, members } = map.get(name)!
    return { card, stackCount: members.length > 1 ? members.length : undefined, members: members.length > 1 ? members : undefined }
  })
}

type Seat = { player: GamePlayer; x: number; z: number; yaw: number; isViewer: boolean }

type BattlefieldRow = {
  placed: ReturnType<typeof row>
  overflow: number
  z: number
}

type PlacedAttachment = { card: GameCard; pos: [number, number, number]; gap: number }

type BattlefieldLayout = { rows: BattlefieldRow[]; attachments: PlacedAttachment[] }

/** THE battlefield layout, in a seat's LOCAL space — the single source of truth
 *  shared by PlayerZone (rendering) and BoardArrows (arrow anchors), so arrows
 *  always land where cards actually draw. Standard MTG rows front → back:
 *  creatures · non-creature/non-land permanents (only when any exist) · lands,
 *  with same-named lands collapsed into one slot (Arena-style), rows scaled by
 *  the cardGap pref, and each row sliced to MAX_PER_ROW unless expanded.
 *  Attached permanents (auras/equipment: `attachedTo` a host on this same
 *  battlefield) don't take a row slot of their own — they tuck UNDER their
 *  host, stepped +0.35 local z (toward the seat) and slightly lower per
 *  attachment so the host always draws on top. */
function battlefieldLayout(player: GamePlayer, cardGap: number, expanded: boolean, rowGap = 1, cardScale = 1): BattlefieldLayout {
  const all = player.battlefield
  const ids = new Set(all.map((c) => c.id))
  const isAttached = (c: GameCard) => !!c.attachedTo && ids.has(c.attachedTo)
  const creatures: RowItem[] = []
  const others: RowItem[] = [] // artifacts, enchantments, planeswalkers, …
  const lands: GameCard[] = []
  for (const c of all) {
    if (isAttached(c)) continue // tucks under its host — no row slot
    const t = (c.types ?? []).map((x) => x.toLowerCase())
    if (t.some((x) => x.includes('creature'))) creatures.push({ card: c })
    else if (t.some((x) => x.includes('land'))) lands.push(c)
    else others.push({ card: c })
  }
  const landRow = groupLands(lands)
  // The middle row only appears when there are other permanents, so a plain
  // creature+land board keeps its roomy two-row spacing.
  const defs = others.length
    ? [
        { items: creatures, z: -1.2 * rowGap },
        { items: others, z: 0.3 * rowGap },
        { items: landRow, z: 1.75 * rowGap },
      ]
    : [
        { items: creatures, z: -0.95 * rowGap },
        { items: landRow, z: 0.95 * rowGap },
      ]
  // cardScale widens the pitch with the cards so scaled-up cards don't overlap
  const spread = cardGap * cardScale
  const rows = defs.map((d) => {
    const overflow = Math.max(0, d.items.length - MAX_PER_ROW)
    const vis = expanded ? d.items : d.items.slice(0, MAX_PER_ROW)
    // cardGap scales both the gap and the row's max width so cards actually spread
    return { placed: row(vis, 0, d.z, 1.45 * spread, MAX_ROW_W * spread), overflow, z: d.z }
  })

  // tuck each attachment under its (transitively resolved) placed host —
  // an aura on an equipment on a creature stacks under the same root host
  const slot = new Map<string, { pos: [number, number, number]; gap: number }>()
  for (const r of rows) for (const p of r.placed) slot.set(p.card.id, { pos: p.pos, gap: p.gap })
  const byId = new Map(all.map((c) => [c.id, c]))
  const rootOf = (c: GameCard): string | null => {
    let cur: GameCard = c
    const seen = new Set<string>()
    while (cur.attachedTo && ids.has(cur.attachedTo) && !seen.has(cur.id)) {
      seen.add(cur.id)
      const host = byId.get(cur.attachedTo)
      if (!host) return null
      if (slot.has(host.id)) return host.id
      cur = host
    }
    return null
  }
  const perHost = new Map<string, number>()
  const attachments: PlacedAttachment[] = []
  for (const c of all) {
    if (!isAttached(c)) continue
    const root = rootOf(c)
    if (!root) continue // host clipped by row overflow / on a collapsed land stack — skip
    const n = (perHost.get(root) ?? 0) + 1
    perHost.set(root, n)
    const s = slot.get(root)!
    attachments.push({ card: c, gap: s.gap, pos: [s.pos[0], s.pos[1] - 0.004 * n, s.pos[2] + 0.35 * n] })
  }
  return { rows, attachments }
}

/** World-space fan layout for the centre stack — the single source of truth for
 *  where each stack spell floats, shared by the Billboard renderer and
 *  BoardArrows (so per-spell arrows start at the spell that casts them). */
function stackFan(cards: GameCard[]): { card: GameCard; scale: number; world: THREE.Vector3 }[] {
  const placed = row(cards.map((c) => ({ card: c })), 0, 0.6, 1.4)
  const mid = (placed.length - 1) / 2
  return placed.map(({ card, pos }, i) => {
    // the middle card(s) sit closest to the camera and biggest; outer ones
    // step back + down a touch so a multi-spell stack still fans readably.
    const off = Math.abs(i - mid)
    return { card, scale: 1.5 - off * 0.18, world: new THREE.Vector3(pos[0] * 1.3, TABLE_LIFT + 0.55 - off * 0.12, 0) }
  })
}

/** World position of a seat-local point, applying the seat's yaw + translation. */
function seatToWorld(seat: Seat, local: [number, number, number], y = 0.35): THREE.Vector3 {
  const cos = Math.cos(seat.yaw)
  const sin = Math.sin(seat.yaw)
  const x = local[0]
  const z = local[2]
  return new THREE.Vector3(seat.x + (x * cos + z * sin), y, seat.z + (-x * sin + z * cos))
}

/** A rounded-rectangle shape (XY plane) for playmat backings. */
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/* Factory layout baselines — the board the sliders are calibrated around.
 * A pref of 1.0 (shown as 100%) means BASE×1; sliders swing ±50% from there.
 * (These fold in the hand-tuned values that used to be slider positions:
 * card size 140%, spacing 200%, rows 160%, mat 170/150%, spread 175%.) */
const BASE = { cardScale: 1.4, cardGap: 2.0, rowGap: 1.6, matW: 1.7, matH: 1.5, seatSpread: 1.75 }

const MAT_W = 14.6
const MAT_H = 7.6 // deep enough for three rows (creatures · others · lands)
const MAT_Z = 0.35 // pushed slightly toward the player's back row
// Everything that "sits on the table" (playmats + their cards, the centre rings,
// the active-seat glow, the hand) is lifted by this much so the whole play layer
// floats above the bare table surface as one consistent plane.
const TABLE_LIFT = 0.09

/** A subtle playmat under a seat's zone: a dark fill + a thin coloured frame, so
 *  each player's area reads as one tidy region instead of cards floating loose. */
function SeatMat({ color, active, pileX, maxW }: { color: string; active: boolean; pileX: number; maxW?: number }) {
  const { prefs } = usePrefs()
  // wide enough that the zone piles (at ±pileX) always sit ON the mat, but no
  // wider than the seat's share of the table (3p/4p corners must not overlap)
  let w = Math.max(MAT_W * prefs.matW * BASE.matW, 2 * (pileX + CARD_W / 2 + 0.35))
  if (maxW) w = Math.min(w, Math.max(maxW, 2 * (pileX + CARD_W / 2 + 0.35)))
  // deep enough for the three battlefield rows + the back pile column even
  // when the mat-height pref is dialed down (shrinking below content is noise)
  const h = Math.max(MAT_H * prefs.matH * BASE.matH, 6.0)
  const fill = useMemo(() => new THREE.ShapeGeometry(roundedRectShape(w, h, 0.5)), [w, h])
  const frame = useMemo(() => new THREE.ShapeGeometry(roundedRectShape(w + 0.18, h + 0.18, 0.56)), [w, h])
  useEffect(() => () => { fill.dispose(); frame.dispose() }, [fill, frame])
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, MAT_Z]}>
      {/* polygonOffset gives each layer a stable depth bias so the near-coplanar
          mat / frame / table don't z-fight (which caused the flicker) */}
      {/* renderOrder forces the mat to draw before the cards regardless of
          distance sorting, so a far/back-row card never ends up painted under it */}
      <mesh geometry={frame} renderOrder={-3}>
        <meshBasicMaterial
          color={color} transparent opacity={active ? 0.42 : 0.2} toneMapped={false}
          depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
        />
      </mesh>
      <mesh geometry={fill} renderOrder={-2}>
        <meshBasicMaterial
          color="#0a0c12" transparent opacity={0.5} toneMapped={false}
          depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  )
}

function PlayerZone({
  seat,
  active,
  matColor,
  cardProps,
  onHoverCard,
  onOpenMenu,
  onOpenZone,
  occludeBadges,
  matMaxW,
}: {
  seat: Seat
  active: boolean
  matColor: string
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  onOpenMenu?: (c: GameCard, members?: GameCard[]) => void
  onOpenZone?: (player: GamePlayer, zone: BrowsableZone) => void
  occludeBadges?: boolean
  matMaxW?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const { prefs } = usePrefs()
  const cardGap = prefs.cardGap * BASE.cardGap
  const cardScale = (prefs.cardScale || 1) * BASE.cardScale
  const rowGap = (prefs.rowGap || 1) * BASE.rowGap

  // battlefieldLayout is the shared layout helper — BoardArrows anchors to the
  // exact same positions, so arrows always land on rendered cards
  const layout = useMemo(
    () => battlefieldLayout(seat.player, cardGap, expanded, rowGap, cardScale),
    [seat.player, cardGap, expanded, rowGap, cardScale],
  )
  const rows = layout.rows
  const placed = useMemo(() => rows.flatMap((r) => r.placed), [rows])
  const anyOverflow = rows.some((r) => r.overflow > 0)

  const p = seat.player
  const gy = p.graveyard.length ? p.graveyard[p.graveyard.length - 1] : null
  const ex = p.exile.length ? p.exile[p.exile.length - 1] : null
  const cmd = p.command ?? []
  const pileX = pileXFor(cardGap, cardScale)

  // X position of the overflow badge: one gap-width past the last visible card,
  // read straight off the placed row so it always lines up (cardGap + the
  // MAX_ROW_W compression included) with no duplicated layout math.
  const overflowX = (r: BattlefieldRow) => {
    const last = r.placed[r.placed.length - 1]
    return last ? last.pos[0] + last.gap : 0
  }

  return (
    <group position={[seat.x, TABLE_LIFT, seat.z]} rotation={[0, seat.yaw, 0]}>
      <SeatMat color={matColor} active={active} pileX={pileX} maxW={matMaxW} />
      {placed.map(({ card, pos, stackCount, members, gap }) => (
        <Card3D key={card.id} card={card} position={pos} stackCount={stackCount} members={members} rowGap={gap} cardProps={cardProps} onHoverCard={onHoverCard} onOpenMenu={onOpenMenu} occludeBadges={occludeBadges} worldScale={cardScale} />
      ))}
      {/* attached permanents (auras/equipment) tucked under their hosts —
          same positions BoardArrows anchors to */}
      {layout.attachments.map(({ card, pos, gap }) => (
        <Card3D key={card.id} card={card} position={pos} rowGap={gap} cardProps={cardProps} onHoverCard={onHoverCard} onOpenMenu={onOpenMenu} occludeBadges={occludeBadges} worldScale={cardScale} />
      ))}
      {/* overflow badges: show +N when a row is clipped */}
      {!expanded &&
        rows.map((r, i) =>
          r.overflow > 0 ? (
            <Html key={i} position={[overflowX(r), 0.2, r.z]} center distanceFactor={10} zIndexRange={[20, 0]}>
              <button className="c3d-overflow-btn" onClick={() => setExpanded(true)}>
                +{r.overflow}
              </button>
            </Html>
          ) : null,
        )}
      {/* collapse button when all cards are shown */}
      {expanded && anyOverflow && (
        <Html position={[0, 0.3, -1.8]} center distanceFactor={10} zIndexRange={[20, 0]}>
          <button className="c3d-overflow-btn c3d-overflow-collapse" onClick={() => setExpanded(false)}>
            ▲ collapse
          </button>
        </Html>
      )}
      {/* zone piles — standard playmat: library + graveyard to the player's
          right, exile set apart on the left ("outside the game").
          pileX scales with cardGap so widened rows never bury the piles. */}
      <CardPile position={[pileX, 1.7]} count={p.libraryCount} faceUp={false} label="Lib" cardProps={cardProps} onHoverCard={onHoverCard} occludeBadges={occludeBadges} />
      <CardPile position={[pileX, 0.0]} count={p.graveyardCount} top={gy} faceUp label="GY" cardProps={cardProps} onHoverCard={onHoverCard} occludeBadges={occludeBadges} onOpen={onOpenZone ? () => onOpenZone(p, 'graveyard') : undefined} />
      <CardPile position={[-pileX, 1.7]} count={p.exile.length} top={ex} faceUp label="Exile" cardProps={cardProps} onHoverCard={onHoverCard} occludeBadges={occludeBadges} onOpen={onOpenZone ? () => onOpenZone(p, 'exile') : undefined} />
      {/* command zone: commanders / emblems / planes / dungeons — a 4th pile on
          the exile side, only when the zone has anything in it. The top card
          goes through the normal card-action path, so a castable commander is
          clickable exactly like any playable card. */}
      {cmd.length > 0 && (
        <CardPile
          position={[-pileX, 2.3]}
          count={cmd.length}
          top={cmd[cmd.length - 1]}
          faceUp
          label="Cmd"
          cardProps={cardProps}
          onHoverCard={onHoverCard}
          occludeBadges={occludeBadges}
          onOpen={onOpenZone ? () => onOpenZone(p, 'command') : undefined}
        />
      )}
    </group>
  )
}

/** Seat N players radially around the table: the viewer at the front (+z) and
 *  the rest spread evenly around the circle, each facing the centre. Scales the
 *  radius up with the player count so seats don't crowd. */
function seatPlayers(players: GamePlayer[], me?: string | null, spread = 1): { seats: Seat[]; radius: number; spectating: boolean } {
  const found = players.findIndex((p) => p.name === me)
  const spectating = found < 0 // me isn't a player → watching, so nobody is "You"
  const viewerIdx = spectating ? 0 : found
  // when spectating, keep natural seat order; otherwise pull the viewer to the front
  const ordered = spectating ? players : [players[viewerIdx], ...players.filter((_, i) => i !== viewerIdx)]
  const n = ordered.length
  // push seats further apart as the table fills so a busy multiplayer board has
  // breathing room (an 8.8-wide playmat needs the seats well separated)
  const radius = Math.max(4.3, 2.5 + n * 1.35) * spread
  const seats = ordered.map((player, i) => {
    const theta = Math.PI / 2 + (i * 2 * Math.PI) / n // front seat at +z
    return {
      player,
      x: radius * Math.cos(theta),
      z: radius * Math.sin(theta),
      yaw: Math.PI / 2 - theta, // rotate local -z to point at the centre
      isViewer: !spectating && i === 0,
    }
  })
  return { seats, radius, spectating }
}

type ViewTarget = { pos: THREE.Vector3; look: THREE.Vector3 }

function CameraRig({ target, look }: { target: ViewTarget; look: MutableRefObject<THREE.Vector3> }) {
  const { camera } = useThree()
  useFrame(() => {
    // Stop micro-lerping once close enough. Infinite lerp keeps the camera in
    // constant motion, which causes R3F to re-evaluate pointer intersections
    // every frame — the changing ray angle flickers card-hover detection.
    const SNAP = 0.0015
    if (camera.position.distanceTo(target.pos) > SNAP) camera.position.lerp(target.pos, 0.1)
    else camera.position.copy(target.pos)
    if (look.current.distanceTo(target.look) > SNAP) look.current.lerp(target.look, 0.1)
    else look.current.copy(target.look)
    camera.lookAt(look.current)
  })
  return null
}

/** Cinematic auto-camera, anchored to the VIEWER's seat: you always see the
 *  table from your own side (never mirrored), with a bounded swing toward an
 *  active opponent and a combat ease-in toward the centre. Spectators follow
 *  the active seat; with no anchor at all it slowly circles the whole table.
 *  The angle is interpolated along the shortest arc so a turn change swooshes
 *  around the rim rather than cutting straight across; once settled the camera
 *  snaps and stops (mirrors CameraRig's SNAP — perpetual micro-motion re-runs
 *  the pointer raycast every frame and flickers card hover). */
function CinematicRig({
  seats,
  activeName,
  radius,
  zoom,
  combat,
  look,
}: {
  seats: Seat[]
  activeName?: string | null
  radius: number
  zoom: number
  combat: number
  look: MutableRefObject<THREE.Vector3>
}) {
  const { camera } = useThree()
  const { prefs } = usePrefs()
  // start from wherever the camera currently is so a mode switch glides, not cuts
  const cyl = useRef({
    theta: Math.atan2(camera.position.z, camera.position.x),
    r: Math.hypot(camera.position.x, camera.position.z),
    y: camera.position.y,
  })

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05) // clamp after tab-switch stalls
    const active = seats.find((s) => s.player.name === activeName)
    const viewer = seats.find((s) => s.isViewer)
    const anchor = viewer ?? active // spectators follow the active seat

    // combat eases the LOOK toward the centre of the table for drama. It must
    // not shrink the camera radius: the resting framing is already tight, and
    // dollying in pushes the far-side combat arrows off the top of the canvas.
    const combatPull = combat > 0 ? 0.78 : 1

    let targetTheta: number
    let lookTarget: THREE.Vector3
    let targetR: number
    let targetY: number
    if (anchor) {
      targetTheta = Math.atan2(anchor.z, anchor.x) // camera sits outside the viewer's seat
      if (viewer && active && active !== viewer) {
        // opponent's turn: swing a bounded arc (≤ ~35°) toward their seat
        let d = Math.atan2(active.z, active.x) - targetTheta
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        targetTheta += Math.max(-0.61, Math.min(0.61, d))
      }
      // composition: frame your own board, leaning part-way toward the active
      // seat when it isn't yours; the low look-y pushes the board into the upper
      // ~65% of the canvas, clear of the DOM hand fan along the bottom
      const viewerIsActive = !!viewer && viewer === active
      const t = viewerIsActive ? 1 : 0.35
      const toSeat = active ?? anchor
      lookTarget = new THREE.Vector3(
        (anchor.x * 0.55 + (toSeat.x * 0.32 - anchor.x * 0.55) * t) * combatPull,
        // pitch scales with the table so bigger layouts stay fully framed
        -(radius * 0.28),
        (anchor.z * 0.55 + (toSeat.z * 0.32 - anchor.z * 0.55) * t) * combatPull,
      )
      targetR = (radius * 1.5 + 3.0) / zoom
      targetY = (radius * 1.05 + 2.0) / Math.sqrt(zoom)
    } else {
      // no viewer or active player (pre-game overview) → slow continuous circle,
      // unless the player asked for reduced motion
      targetTheta = cyl.current.theta + (prefs.reduceMotion ? 0 : 0.5)
      lookTarget = new THREE.Vector3(0, 0.5, 0)
      targetR = (radius + 5.8) / zoom
      targetY = (radius + 3.8) / Math.sqrt(zoom)
    }

    // shortest-arc angle lerp → swoosh around the rim; snap when settled so the
    // camera actually stops (no drift, no endless asymptotic micro-lerp)
    const SNAP = 0.002
    let dTheta = targetTheta - cyl.current.theta
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI
    if (Math.abs(dTheta) > SNAP) cyl.current.theta += dTheta * Math.min(1, dt * (anchor ? 1.7 : 0.3))
    else cyl.current.theta += dTheta
    if (Math.abs(targetR - cyl.current.r) > SNAP) cyl.current.r += (targetR - cyl.current.r) * Math.min(1, dt * 2.4)
    else cyl.current.r = targetR
    if (Math.abs(targetY - cyl.current.y) > SNAP) cyl.current.y += (targetY - cyl.current.y) * Math.min(1, dt * 2.4)
    else cyl.current.y = targetY
    camera.position.set(Math.cos(cyl.current.theta) * cyl.current.r, cyl.current.y, Math.sin(cyl.current.theta) * cyl.current.r)

    if (look.current.distanceTo(lookTarget) > SNAP) look.current.lerp(lookTarget, Math.min(1, dt * 2.2))
    else look.current.copy(lookTarget)
    camera.lookAt(look.current)
  })
  return null
}

/** Mobile free-cam framing: put the top-down camera high enough that the whole
 *  board (seat mats included) fits the frustum, refit whenever the canvas
 *  resizes (rotation, browser chrome) — a fixed y=16 clipped the far mats.
 *  The DOM hand fan overlays the bottom of the canvas, so the fit also reserves
 *  that band and floats the board up into the clear area — otherwise the
 *  viewer's own battlefield rows sit permanently behind the fan and can never
 *  be tapped. `fanCards` re-fits when the hand appears/empties. */
function MobileCamFit({ radius, fanCards }: { radius: number; fanCards: number }) {
  const { camera, gl, size } = useThree()
  const { prefs } = usePrefs()
  const effMatH = MAT_H * prefs.matH * BASE.matH
  // the drei OrbitControls (makeDefault) registers itself here; it owns the
  // look-at target in free mode, so the fit must move THAT, not just lookAt
  const controls = useThree((s) => s.controls) as ({ target: THREE.Vector3; update: () => void } & object) | null
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const halfFov = ((cam.fov ?? 46) * Math.PI) / 360
    const tan = Math.tan(halfFov)
    const aspect = size.width / Math.max(1, size.height)
    // vertical (world z) half-extent of the board: seat radius + mat depth
    const ez = radius + effMatH / 2 + MAT_Z + 0.8
    // fraction of the canvas covered by the hand fan's cards — measured, so it
    // tracks the hand-size pref and mobile scaling; capped so a squat canvas
    // can't shrink the board into a sliver
    const canvasRect = gl.domElement.getBoundingClientRect()
    const cardRect = document.querySelector('.hand-fan .hand-card')?.getBoundingClientRect()
    const covered = cardRect ? Math.max(0, canvasRect.bottom - cardRect.top) : 0
    const f = Math.min(0.4, covered / Math.max(1, canvasRect.height || size.height))
    let y = ez / (tan * (1 - f))
    // narrow viewports must also fit the board's horizontal (world x) extent
    if (aspect < 1.4) {
      const ex = MAT_W / 2 + 0.8
      y = Math.max(y, ex / (tan * aspect))
    }
    // shift the look point so the reserved band sits BELOW the board: the
    // visible half-height is y·tan; offsetting by its fan fraction pins the
    // board's far edge to the top of the canvas and leaves the fan band clear
    const lookZ = y * tan * f
    camera.position.set(0, y, lookZ + 0.01)
    if (controls) {
      controls.target.set(0, 0, lookZ)
      controls.update()
    } else {
      camera.lookAt(0, 0, lookZ)
    }
  }, [camera, gl, controls, size.width, size.height, radius, fanCards, effMatH])
  return null
}

/** A pulsing gold ring on the table under the active player's zone, so whose
 *  turn it is reads at a glance (pairs with the Auto camera). */
function ActiveSeatGlow({ seat }: { seat: Seat }) {
  const ref = useRef<THREE.Mesh>(null)
  const clock = useRef(0)
  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.05)
    const m = ref.current
    if (!m) return
    const p = 0.5 + 0.5 * Math.sin(clock.current * 2.1)
    ;(m.material as THREE.MeshBasicMaterial).opacity = 0.22 + p * 0.4
    const s = 1 + p * 0.05
    m.scale.set(s, s, s)
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[seat.x * 0.66, TABLE_LIFT + 0.015, seat.z * 0.66]}>
      <ringGeometry args={[1.75, 2.05, 64]} />
      <meshBasicMaterial color="#ffce54" transparent opacity={0.4} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

// attackBlocked = legacy-client gray: a blocked attacker no longer threatens the defender
// palette ↔ legacy semantics: attack red, blocked-attack gray, block orange
// (legacy blue), target cyan (legacy red), paired green (matches legacy PAIRED)
const ARROW_COLOR: Record<string, string> = { attack: '#ff3b3b', attackBlocked: '#9aa0a6', block: '#ffb13b', target: '#3bd6ff', paired: '#39d98a' }

/** A single arced 3D arrow (tube shaft + cone head + glow) from `from` to `to`.
 *  The control point bows the arc UP *and* SIDEWAYS — a purely vertical arc on a
 *  shot that runs away from the camera collapses into an unreadable straight line,
 *  so the lateral swing is what makes it legible as an arrow from any seat view. */
function Arrow({ from, to, kind, bend = 1 }: { from: THREE.Vector3; to: THREE.Vector3; kind: string; bend?: number }) {
  const { tube, glow, headPos, headQuat } = useMemo(() => {
    const dir = to.clone().sub(from)
    const horiz = Math.hypot(dir.x, dir.z) || 0.001
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize()
    const mid = from.clone().lerp(to, 0.5)
    // low, slim arcs — the camera sits close, so fat high arcs read as walls
    mid.y += horiz * 0.16 + 0.55 // bow up over the board
    mid.add(perp.multiplyScalar(Math.min(1.9, horiz * 0.22) * bend)) // and out to the side
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const tube = new THREE.TubeGeometry(curve, 40, 0.05, 10, false)
    const glow = new THREE.TubeGeometry(curve, 40, 0.11, 10, false)
    const tan = curve.getTangentAt(1).normalize()
    const headQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan)
    const headPos = to.clone().addScaledVector(tan, -0.3) // pull the cone back so its tip lands on `to`
    return { tube, glow, headPos, headQuat }
  }, [from, to, bend])
  useEffect(() => () => { tube.dispose(); glow.dispose() }, [tube, glow])
  const color = ARROW_COLOR[kind] ?? '#ffffff'
  return (
    <group userData={{ arrowKind: kind, arrowHead: headPos.toArray() }}>
      <mesh geometry={glow} renderOrder={998}>
        <meshBasicMaterial color={color} transparent opacity={0.22} toneMapped={false} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh geometry={tube} renderOrder={999}>
        <meshBasicMaterial color={color} transparent opacity={0.98} toneMapped={false} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={headPos} quaternion={headQuat} renderOrder={999}>
        <coneGeometry args={[0.2, 0.55, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Arena/xmage-style action arrows: attackers→defender, blockers→attacker, and
 *  (when targeting) the stack→each selected target. Derived from combat + prompt. */
function BoardArrows({
  seats,
  combat,
  targets,
  stack,
}: {
  seats: Seat[]
  combat: GameState['combat']
  targets?: string[]
  stack?: GameState['stack']
}) {
  const { prefs } = usePrefs()
  const cardGap = prefs.cardGap * BASE.cardGap
  const cardScale = (prefs.cardScale || 1) * BASE.cardScale
  const rowGap = (prefs.rowGap || 1) * BASE.rowGap
  const arrows = useMemo(() => {
    // id → world position: battlefield cards via the SAME layout helper the
    // renderer uses (cardGap + MAX_PER_ROW slice included; rows assumed
    // collapsed), each stack spell's fan slot, plus each player's seat centre
    const pos = new Map<string, THREE.Vector3>()
    for (const s of seats) {
      const layout = battlefieldLayout(s.player, cardGap, false, rowGap, cardScale)
      for (const r of layout.rows)
        for (const { card, pos: lp } of r.placed) pos.set(card.id, seatToWorld(s, lp))
      // attachments register at their real (tucked) position
      for (const { card, pos: lp } of layout.attachments) pos.set(card.id, seatToWorld(s, lp))
      const centre = new THREE.Vector3(s.x * 0.8, 0.6, s.z * 0.8)
      pos.set('P:' + s.player.id, centre)
      pos.set('P:' + s.player.name, centre)
    }
    for (const { card, world } of stackFan(stack ?? [])) pos.set(card.id, world)
    const out: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = []
    for (const cg of combat) {
      // defenderId (a player OR planeswalker/battle uuid) resolves against the
      // position map; the defender NAME is only a legacy fallback
      const defPos =
        (cg.defenderId ? pos.get(cg.defenderId) ?? pos.get('P:' + cg.defenderId) : undefined) ??
        (cg.defender ? pos.get('P:' + cg.defender) : undefined) ??
        null
      const attackKind = cg.blocked ? 'attackBlocked' : 'attack'
      for (const aid of cg.attackers) {
        const ap = pos.get(aid)
        if (ap && defPos) out.push({ from: ap, to: defPos, kind: attackKind })
        if (ap) {
          for (const bid of cg.blockers) {
            const bp = pos.get(bid)
            if (bp) out.push({ from: bp, to: ap, kind: 'block' })
          }
        }
      }
    }
    // soulbond pairs: one subtle arrow per pair (legacy draws these green).
    // Dedupe by drawing only from the lexically-smaller id so a pair doesn't
    // produce two overlapping arrows.
    for (const s of seats) {
      for (const c of s.player.battlefield) {
        if (!c.pairedCard || c.id >= c.pairedCard) continue
        const a = pos.get(c.id)
        const b = pos.get(c.pairedCard)
        if (a && b) out.push({ from: a, to: b, kind: 'paired' })
      }
    }
    // fallback origin for a spell not yet on the stack (active-target prompt)
    const stackCentre = new THREE.Vector3(0, TABLE_LIFT + 0.55, 0)
    // persistent arrows for every spell/ability on the stack → what it targets.
    // Abilities start from their source permanent; spells from their own fan
    // slot (so with 2+ stacked spells each arrow starts at the right card, and
    // a counterspell targeting another stack spell draws card → card).
    for (const item of stack ?? []) {
      if (!item.targets || !item.targets.length) continue
      const from = (item.sourceId && pos.get(item.sourceId)) || pos.get(item.id) || stackCentre
      for (const t of item.targets) {
        const tp = pos.get(t) ?? pos.get('P:' + t)
        if (tp) out.push({ from, to: tp, kind: 'target' })
      }
    }
    // arrows for the target you're actively choosing (before it's on the stack)
    if (targets && targets.length) {
      for (const t of targets) {
        const tp = pos.get(t) ?? pos.get('P:' + t)
        if (tp) out.push({ from: stackCentre, to: tp, kind: 'target' })
      }
    }
    return out
  }, [seats, combat, targets, stack, cardGap, cardScale, rowGap])

  return (
    <>
      {arrows.map((a, i) => (
        // fan multiple arrows to alternating sides + magnitudes so they don't overlap
        <Arrow key={i} from={a.from} to={a.to} kind={a.kind} bend={(i % 2 ? -1 : 1) * (1 + Math.floor(i / 2) * 0.5)} />
      ))}
    </>
  )
}

type ViewMode = '3d' | '2d' | 'free' | 'auto'

const ZOOM_MIN = 0.35
const ZOOM_MAX = 3.0
const ZOOM_STEP = 0.25
const ZOOM_DEFAULT = 1.0

/** Scale the camera's distance from its look-at point by 1/zoom.
 *  zoom=1 → no change; zoom=2 → twice as close; zoom=0.5 → twice as far. */
function applyZoom(t: ViewTarget, zoom: number): ViewTarget {
  const dir = t.pos.clone().sub(t.look)
  return { pos: t.look.clone().addScaledVector(dir, 1 / zoom), look: t.look.clone() }
}

/**
 * Read-only test/debug instrumentation. Lives INSIDE the <Canvas> so it can read
 * the live three.js camera + scene, and exposes a tiny side-effect-free API on
 * `window.__board3d` that gesture tests use to (a) project a card's world
 * position to canvas pixels so a tap can be aimed at a real card, and (b) read
 * the camera (position / orbit target / distance) and the custom zoom factor so
 * a gesture's effect is assertable. It never mutates the scene.
 *
 * Always exposed (not DEV-gated): the production `vite build` the test webServer
 * serves has `import.meta.env.DEV === false`, so a DEV gate would hide it from
 * tests. The object is minimal and readonly, which is acceptable for a game
 * client. The hook is removed on unmount so it never dangles after leaving the board.
 */
function BoardDebug({ zoom, mode, look }: { zoom: number; mode: ViewMode; look: THREE.Vector3 | null }) {
  const three = useThree()
  // keep a live ref so every API call reads the current frame's camera/controls
  const ref = useRef({ three, zoom, mode, look })
  ref.current = { three, zoom, mode, look }
  useEffect(() => {
    const project = (v: THREE.Vector3) => {
      const { three } = ref.current
      const p = v.clone().project(three.camera)
      const el = three.gl.domElement
      const w = el.clientWidth || el.width
      const h = el.clientHeight || el.height
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, z: p.z, w, h }
    }
    const cards = () => {
      const { three } = ref.current
      const out: { id: string; x: number; y: number }[] = []
      three.scene.traverse((o) => {
        const id = o.userData?.cardId as string | undefined
        if (!id) return
        const wp = new THREE.Vector3()
        o.getWorldPosition(wp)
        const p = project(wp)
        // on-screen + in front of the camera (z<1) → a tappable target
        if (p.z < 1 && p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h) out.push({ id, x: p.x, y: p.y })
      })
      return out
    }
    // every rendered card with the visual facts a verifier needs: on-screen, and
    // whether it's drawn tapped (the flat card mesh rotates ~90° on Z when tapped)
    const rendered = () => {
      const { three } = ref.current
      const out: { id: string; x: number; y: number; onScreen: boolean; tapped: boolean; faceDown: boolean }[] = []
      three.scene.traverse((o) => {
        const id = o.userData?.cardId as string | undefined
        if (!id) return
        const wp = new THREE.Vector3()
        o.getWorldPosition(wp)
        const p = project(wp)
        out.push({
          faceDown: !!o.userData?.faceDown,
          id,
          x: p.x,
          y: p.y,
          onScreen: p.z < 1 && p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h,
          tapped: Math.abs((o as THREE.Object3D).rotation.z) > 0.5,
        })
      })
      return out
    }
    // the in-canvas badge sprites (P/T, loyalty, damage) with on-screen visibility,
    // so tests can verify the annotation renders + isn't occluded
    const badges = () => {
      const { three } = ref.current
      const out: { cardId: string; text: string; onScreen: boolean }[] = []
      three.scene.traverse((o) => {
        const cardId = o.userData?.badgeCardId as string | undefined
        const text = o.userData?.badgeText as string | undefined
        if (!cardId || text == null) return
        const wp = new THREE.Vector3()
        o.getWorldPosition(wp)
        const p = project(wp)
        out.push({ cardId, text, onScreen: o.visible && p.z < 1 && p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h })
      })
      return out
    }
    const api = {
      mode: () => ref.current.mode,
      zoom: () => ref.current.zoom,
      rendered,
      badges,
      camera: () => {
        const { three, look } = ref.current
        // free mode → OrbitControls owns the orbit target; otherwise use the
        // CameraRig look point so `distance` is meaningful in every mode.
        const ctrlTarget = (three.controls as { target?: THREE.Vector3 } | null)?.target
        const tgt = ctrlTarget ?? look ?? new THREE.Vector3()
        return {
          pos: three.camera.position.toArray() as [number, number, number],
          target: tgt.toArray() as [number, number, number],
          distance: three.camera.position.distanceTo(tgt),
        }
      },
      cards,
      cardScreenPos: (id: string) => cards().find((c) => c.id === id) ?? null,
      // action arrows currently in the scene (attack / block / target), tagged via
      // userData.arrowKind on each Arrow group. Each entry reports the kind plus the
      // arrowhead's projected screen position + visibility, so tests can assert the
      // arrows not only exist but actually land on-screen.
      arrows: () => {
        const { three } = ref.current
        const out: { kind: string; x: number; y: number; onScreen: boolean }[] = []
        three.scene.traverse((o) => {
          const kind = o.userData?.arrowKind as string | undefined
          const head = o.userData?.arrowHead as [number, number, number] | undefined
          if (!kind || !head) return
          const p = project(new THREE.Vector3(head[0], head[1], head[2]))
          out.push({ kind, x: p.x, y: p.y, onScreen: p.z < 1 && p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h })
        })
        return out
      },
    }
    ;(window as unknown as { __board3d?: typeof api }).__board3d = api
    return () => {
      const w = window as unknown as { __board3d?: typeof api }
      if (w.__board3d === api) delete w.__board3d
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/** Live board-layout sliders floating over the board, so the effect of each
 *  slider is visible while dragging (the Settings page mirrors these prefs). */
function BoardTuner() {
  const [open, setOpen] = useState(false)
  const { prefs, setPref } = usePrefs()
  const SLIDERS: [keyof typeof prefs & ('cardScale' | 'cardGap' | 'rowGap' | 'matW' | 'matH' | 'seatSpread'), string, number, number][] = [
    ['cardScale', 'Card size', 0.5, 1.5],
    ['cardGap', 'Card spacing ↔', 0.5, 1.5],
    ['rowGap', 'Row spacing ↕', 0.5, 1.5],
    ['matW', 'Mat width', 0.5, 1.5],
    ['matH', 'Mat depth', 0.5, 1.5],
    ['seatSpread', 'Table spread', 0.5, 1.5],
  ]
  return (
    <div className={`board-tuner${open ? ' open' : ''}`}>
      <button className="btn tuner-fab" onClick={() => setOpen((o) => !o)} title="Board layout" aria-label="Board layout tuner">
        ⚙
      </button>
      {open && (
        <div className="tuner-panel" role="group" aria-label="Board layout tuner">
          {SLIDERS.map(([key, label, min, max]) => (
            <label className="tuner-row" key={key}>
              <span className="tuner-label">
                {label} <em>{Math.round((prefs[key] || 1) * 100)}%</em>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={0.05}
                value={prefs[key] || 1}
                onChange={(e) => setPref(key, Number(e.target.value))}
              />
            </label>
          ))}
          <button
            className="btn tuner-reset"
            onClick={() => SLIDERS.forEach(([key]) => setPref(key, 1))}
          >
            Reset layout
          </button>
        </div>
      )}
    </div>
  )
}

/** Compact +/− zoom strip shown in 3D and 2D modes. */
function ZoomBar({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  return (
    <div className="zoom-bar">
      <button
        className="btn zoom-btn"
        onClick={() => onZoom(Math.max(ZOOM_MIN, +(zoom - ZOOM_STEP).toFixed(2)))}
        title="Zoom out"
        aria-label="Zoom out"
      >
        −
      </button>
      <button className="zoom-label" type="button" title="Reset zoom" aria-label="Reset zoom" onClick={() => onZoom(ZOOM_DEFAULT)}>
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="btn zoom-btn"
        onClick={() => onZoom(Math.min(ZOOM_MAX, +(zoom + ZOOM_STEP).toFixed(2)))}
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  )
}

/** Camera control: a small glass panel that expands from a corner button, with a
 *  Camera row (Auto/3D/2D/Free) and a Focus row (Overview + each seat); picking
 *  a focus target snaps into 3D mode. */
function ViewMenu({
  mode,
  setMode,
  views,
  view,
  setView,
}: {
  mode: ViewMode
  setMode: (m: ViewMode) => void
  views: { name: string }[]
  view: number
  setView: (i: number) => void
}) {
  const [open, setOpen] = useState(false)
  type Item = { key: string; label: string; active: boolean; cat: string; onClick: () => void }
  const modeItems: Item[] = (['auto', '3d', '2d', 'free'] as ViewMode[]).map((m) => ({
    key: 'm-' + m,
    label: m === '3d' ? '3D' : m === '2d' ? '2D' : m === 'auto' ? 'Auto' : 'Free',
    active: mode === m,
    cat: 'mode',
    onClick: () => setMode(m),
  }))
  // focus targets snap the camera, so picking one implies the 3D snap mode
  const focusItems: Item[] = views.map((v, i) => ({
    key: 'f-' + i,
    label: v.name,
    active: mode === '3d' && view === i,
    cat: 'focus',
    onClick: () => {
      setMode('3d')
      setView(i)
    },
  }))

  return (
    <div className={`view-menu${open ? ' open' : ''}`}>
      <button className="view-fab" onClick={() => setOpen((o) => !o)} aria-label="View options">
        {open ? '✕' : '⊙'}
      </button>
      {/* Styled hover tooltip — sits to the RIGHT of the fab, never where the
          panel opens (below). Only rendered while the panel is closed, so it can
          never cover the panel's controls (the old native title did). */}
      {!open && (
        <span className="view-fab-tip" role="tooltip">
          View options
        </span>
      )}
      {open && (
        <div className="view-panel panel">
          <div className="view-group">
            <span className="view-group-label">Camera</span>
            <div className="view-row">
              {modeItems.map((it) => (
                <button key={it.key} className={`view-btn view-radial ${it.cat}${it.active ? ' active' : ''}`} onClick={it.onClick}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>
          {focusItems.length > 0 && (
            <div className="view-group">
              <span className="view-group-label">Focus</span>
              <div className="view-row wrap">
                {focusItems.map((it) => (
                  <button key={it.key} className={`view-btn view-radial ${it.cat}${it.active ? ' active' : ''}`} onClick={it.onClick}>
                    {it.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Board3D({
  game,
  cardProps,
  onHoverCard,
  onOpenMenu,
  onOpenZone,
  targets,
  focusSeat,
}: {
  game: GameState
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  onOpenMenu?: (c: GameCard, members?: GameCard[]) => void
  // open a zone browser overlay for a seat's public pile (GY / exile / command)
  onOpenZone?: (player: GamePlayer, zone: BrowsableZone) => void
  targets?: string[]
  // a request to swing the 3D camera to a given player's seat (the nonce lets the
  // same player be focused repeatedly)
  focusSeat?: { name: string; n: number } | null
}) {
  const { prefs } = usePrefs()
  const chroma = CHROMA_FAMILY[prefs.theme]
  const backdrop = chroma?.backdrop ?? 'vapor'
  const baseScene = SCENE[backdrop] ?? SCENE.vapor
  const scene = {
    ...baseScene,
    bg:    chroma?.bg      ?? baseScene.bg,
    table: chroma?.surface ?? baseScene.table,
    gridA: chroma?.surface ?? baseScene.gridA,
    ring:  chroma?.a       ?? baseScene.ring,
    ring2: chroma?.b       ?? baseScene.ring2,
    gridB: chroma?.a       ?? baseScene.gridB,
    key:   chroma?.a       ?? baseScene.key,
    fill:  chroma?.b       ?? baseScene.fill,
  }

  // seat all players radially around the table (supports 2..N)
  const { seats, radius, spectating } = useMemo(
    () => seatPlayers(game.players, game.me, prefs.seatSpread * BASE.seatSpread),
    [game.players, game.me, prefs.seatSpread],
  )

  // camera viewpoints: an overview + a 3/4 view behind each seat that frames
  // that player's battlefield and (for the viewer) the hand laid in front.
  const views: { name: string; target: ViewTarget }[] = useMemo(
    () => [
      {
        name: 'Overview',
        target: { pos: new THREE.Vector3(0, 11 + seats.length * 0.7, 8.5 + seats.length * 0.4), look: new THREE.Vector3(0, 0, 0) },
      },
      ...seats.map((s) => {
        const len = Math.hypot(s.x, s.z) || 1
        const ux = s.x / len
        const uz = s.z / len
        // Angle the camera so the full player zone (lands in the back row) stays
        // in frame. Look toward the inner part of the zone rather than past
        // centre, which would clip the near cards at the bottom of the frustum.
        const out = radius + 4.2
        return {
          name: s.isViewer ? 'You' : s.player.name,
          target: {
            pos: new THREE.Vector3(ux * out, 7.2, uz * out),
            look: new THREE.Vector3(ux * radius * 0.35, 0.5, uz * radius * 0.35),
          },
        }
      }),
    ],
    [seats, radius],
  )
  // auto = cinematic cam that follows the active player; 2D = fixed top-down;
  // 3D = the angled seat views; free = user-orbited. Same world either way.
  // Live (not one-shot): resizing/rotating a device across the breakpoint
  // re-fits the mobile camera instead of keeping a stale layout.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (max-height: 540px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px), (max-height: 540px)')
    const on = () => setIsMobile(mq.matches)
    mq.addEventListener('change', on)
    window.addEventListener('orientationchange', on)
    return () => {
      mq.removeEventListener('change', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  // Small screens default to free mode: a flat top-down board you pan with one
  // finger and pinch to zoom — a large zoomable/pannable canvas (rotate locked).
  const [mode, setMode] = useState<ViewMode>(() => (isMobile ? 'free' : prefs.defaultCamera))
  // the camera mode in force before a seat-focus request forced '3d' (restored
  // when focus returns to your own seat / clears); user mode picks forget it
  const priorMode = useRef<ViewMode | null>(null)
  const setModeUser = (m: ViewMode) => {
    priorMode.current = null
    setMode(m)
  }
  const TOP_DOWN: ViewTarget = useMemo(
    () => ({ pos: new THREE.Vector3(0, 15 + seats.length * 0.8, 2.2), look: new THREE.Vector3(0, 0, 0) }),
    [seats.length],
  )
  // spectators start on the overview; players start behind their own seat
  const [view, setView] = useState(spectating ? 0 : 1)
  useEffect(() => {
    if (view >= views.length) setView(spectating ? 0 : 1)
  }, [views.length, view, spectating])

  // clicking a player in the strip swings the manual 3D camera to their seat;
  // focusing your own seat (or clearing the focus) restores the prior camera.
  // Each request (nonce) is handled once — a game-state push must not re-force
  // the mode after the user has been restored.
  const handledFocus = useRef<{ name: string; n: number } | null>(null)
  useEffect(() => {
    if (!focusSeat) {
      handledFocus.current = null
      if (priorMode.current != null) {
        setMode(priorMode.current)
        priorMode.current = null
      }
      return
    }
    if (handledFocus.current?.name === focusSeat.name && handledFocus.current?.n === focusSeat.n) return
    const idx = seats.findIndex((s) => s.player.name === focusSeat.name)
    if (idx < 0) return
    handledFocus.current = focusSeat
    if (seats[idx].isViewer && priorMode.current != null) {
      setMode(priorMode.current)
      priorMode.current = null
      return
    }
    setMode((m) => {
      if (m !== '3d' && priorMode.current == null) priorMode.current = m
      return '3d'
    })
    setView(idx + 1) // views[0] is Overview, then one per seat in `seats` order
  }, [focusSeat, seats])

  const [zoom, setZoom] = useState(() => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prefs.boardZoom || ZOOM_DEFAULT)))
  // persist zoom tweaks (debounced) so the next game opens at the same zoom
  const { setPref } = usePrefs()
  useEffect(() => {
    if (zoom === prefs.boardZoom) return
    const t = setTimeout(() => setPref('boardZoom', zoom), 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const rawTarget = mode === '2d' ? TOP_DOWN : views[view].target
  // free mode uses OrbitControls scroll-wheel zoom; for 3d/2d we scale the camera distance
  const target = mode === 'free' ? rawTarget : applyZoom(rawTarget, zoom)

  // the driven rigs (auto/3d/2d) accumulate their look-at point here, so
  // switching modes glides from the current framing and OrbitControls (free)
  // seeds its orbit target from where the camera was last looking
  const lastLook = useRef(new THREE.Vector3(0, 0, 0))
  // snapshot on entering free mode → a stable prop while the user orbits/pans
  const freeSeed = useMemo(
    () => (mode === 'free' ? (lastLook.current.toArray() as [number, number, number]) : null),
    [mode],
  )

  // the hand is no longer laid on the table — it's a fixed screen-space fan at the
  // bottom of the screen (HandFan in GameTable), the way other MTG clients do it
  const stack = useMemo(() => stackFan(game.stack), [game.stack])
  // raycast-occlude the DOM badges so a card in front (the centre stack card, or a
  // hovered/lifted card, or a nearer row) hides the badges of cards behind it
  const occludeBadges = true

  return (
    <div className="board3d">
      <ViewMenu mode={mode} setMode={setModeUser} views={views} view={view} setView={setView} />
      {mode !== 'free' && <ZoomBar zoom={zoom} onZoom={setZoom} />}
      <BoardTuner />
      <Canvas
        shadows
        camera={{ position: isMobile ? [0, 16, 0.01] : [0, 5.4, 10], fov: 46 }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        {/* The same backdrop as the lobby, rendered INSIDE the board canvas so it
            shares the board camera and the depth buffer — the table + cards occlude
            it correctly (no see-through clipping) while still feeling like one scene. */}
        <color attach="background" args={[scene.bg]} />
        <fog attach="fog" args={[scene.bg, 42, 85]} />
        <FamilyBackdrop kind={backdrop} inGame />

        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 11, 6]} intensity={0.9} color={scene.key} castShadow />
        <directionalLight position={[-6, 7, -4]} intensity={0.55} color={scene.fill} />
        <pointLight position={[0, 6, 4]} intensity={0.5} color={scene.ring} distance={26} />
        {/* floor: a neon grid for Vaporwave, plain for other families */}
        {scene.grid && (
          <Grid
            position={[0, -0.05, 0]}
            args={[60, 60]}
            cellSize={1.4}
            cellThickness={1}
            cellColor={scene.gridA}
            sectionSize={7}
            sectionThickness={1.5}
            sectionColor={scene.gridB}
            fadeDistance={42}
            fadeStrength={2}
            infiniteGrid
          />
        )}

        {/* no central table/rings — the per-seat playmats float over the backdrop */}
        {seats.map((s) => (
          <PlayerZone
            key={s.player.id}
            seat={s}
            active={s.player.name === game.activePlayer}
            matColor={s.isViewer ? scene.ring : scene.ring2}
            cardProps={cardProps}
            onHoverCard={onHoverCard}
            onOpenMenu={onOpenMenu}
            onOpenZone={onOpenZone}
            occludeBadges={occludeBadges}
            // 3p+: cap each mat at the chord between adjacent seats so the
            // corners of neighbouring mats can't overlap at default spread
            matMaxW={seats.length >= 3 ? 2 * radius * Math.sin(Math.PI / seats.length) - 0.4 : undefined}
          />
        ))}

        {/* highlight whose turn it is */}
        {(() => {
          const active = seats.find((s) => s.player.name === game.activePlayer)
          return active ? <ActiveSeatGlow seat={active} /> : null
        })()}

        {/* action-direction arrows: attackers→defender, blockers→attacker, targeting */}
        <BoardArrows seats={seats} combat={game.combat} targets={targets} stack={game.stack} />

        {/* stack (center) — a full Billboard squares each card to the camera like an
            old billboard sprite (no axis locks), floated above the table and oversized
            so the spell(s) currently resolving read clearly from any seat. */}
        {stack.map(({ card, world, scale }) => (
          // stackFan is the shared fan layout — BoardArrows anchors each spell's
          // source→target arrows to the same slot the Billboard renders at
          <Billboard key={card.id} position={[world.x, world.y, world.z]} scale={scale}>
            <Card3D card={card} position={[0, 0, 0]} standing showCost cardProps={cardProps} onHoverCard={onHoverCard} onOpenMenu={onOpenMenu} />
          </Billboard>
        ))}

        {/* free cam → user orbits/pans; otherwise the camera is driven to the
            selected (2D top-down or 3D seat) viewpoint */}
        {mode === 'free' ? (
          <>
            <OrbitControls
              makeDefault
              enablePan
              enableDamping
              dampingFactor={0.08}
              minDistance={1.5}
              maxDistance={isMobile ? 60 : 40}
              // seeded from where the driven camera was last looking, so
              // switching to Free doesn't jump-cut the framing back to origin
              target={freeSeed ?? [0, 0, 0]}
              // mobile = a flat pan/pinch canvas: one finger pans, two pinch-zoom,
              // rotation locked so the board stays readable top-down
              enableRotate={!isMobile}
              touches={isMobile ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : undefined}
            />
            {isMobile && <MobileCamFit radius={radius} fanCards={game.myHand?.length ?? 0} />}
          </>
        ) : mode === 'auto' ? (
          <CinematicRig seats={seats} activeName={game.activePlayer} radius={radius} zoom={zoom} combat={game.combat.length} look={lastLook} />
        ) : (
          <CameraRig target={target} look={lastLook} />
        )}

        {/* readonly test instrumentation (window.__board3d) — see BoardDebug */}
        <BoardDebug zoom={zoom} mode={mode} look={mode === 'free' ? null : target.look} />
      </Canvas>
    </div>
  )
}
