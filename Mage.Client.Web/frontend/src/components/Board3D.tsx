import { useEffect, useMemo, useRef, useState } from 'react'
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
 *  Zone piles sit at x ≈ ±PILE_X, so this must stay below PILE_X*2 to prevent
 *  battlefield rows from overflowing into the zone piles. */
const MAX_ROW_W = 4.2
const MAX_PER_ROW = 12
/** X-position of the zone piles (library/GY on the right, exile on the left).
 *  Must be > MAX_ROW_W/2 + CARD_W/2 to keep piles clear of the battlefield rows. */
const PILE_X = 3.5
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
  return `/api/cardimg?set=${encodeURIComponent(c.set ?? '')}&num=${encodeURIComponent(c.num ?? '')}&name=${encodeURIComponent(c.name)}`
}

/** Draw a readable card face on a canvas (name / type / P-T) so a card is never
 *  blank, even when its real art is missing. Real art replaces this once loaded. */
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
  g.font = 'bold 20px "Segoe UI", system-ui, sans-serif'
  g.fillText(fit(card.name, w - 44), 22, 33)
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

type CardProps = (c: GameCard) => { highlight?: 'play' | 'target'; onClick?: (c: GameCard) => void }

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
}: {
  position: [number, number] // local x, z
  count: number
  top?: GameCard | null
  faceUp: boolean
  label: string
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  occludeBadges?: boolean
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

  return (
    <group position={[position[0], 0, position[1]]}>
      {count <= 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.05} />
        </mesh>
      )}
      {/* depth layers (face-down backs) under the top card */}
      {Array.from({ length: Math.max(0, layers - 1) }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0.012 * i, 0.012 + i * step, 0.012 * i]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial map={back} toneMapped={false} transparent depthWrite={false} />
        </mesh>
      ))}
      {/* top of the pile */}
      {count > 0 &&
        (faceUp && top ? (
          <Card3D card={top} position={[0, topY, 0]} cardProps={cardProps} onHoverCard={onHoverCard} />
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY, 0]}>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial map={back} toneMapped={false} transparent depthWrite={false} />
          </mesh>
        ))}
      <Html position={[0, 0.34, CARD_H * 0.62]} center distanceFactor={10} zIndexRange={[15, 0]} occlude={occludeBadges} className="c3d-badge c3d-zone">
        {label} {count}
      </Html>
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
  cardProps,
  onHoverCard,
  onOpenMenu,
  occludeBadges,
}: {
  card: GameCard
  position: [number, number, number]
  standing?: boolean
  showCost?: boolean
  stackCount?: number
  members?: GameCard[]
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  onOpenMenu?: (c: GameCard, members?: GameCard[]) => void
  // only raycast-occlude the DOM badges when there's a central stack to hide them
  // behind — avoids per-frame badge flicker the rest of the time
  occludeBadges?: boolean
}) {
  const [art, setArt] = useState<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
  // touch long-press → preview (right-click does it on desktop); a quick tap plays
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const { highlight, onClick } = cardProps(card)
  const { gl } = useThree()
  const maxAniso = useMemo(() => gl.capabilities.getMaxAnisotropy?.() ?? 8, [gl])

  // always-present readable face; disposed on unmount
  const fallback = useMemo(() => makeCardTexture(card), [card.id, card.name, card.power, card.toughness, card.loyalty])
  useEffect(() => {
    fallback.anisotropy = maxAniso // sharp at the board's viewing angle
    fallback.needsUpdate = true
    return () => fallback.dispose()
  }, [fallback, maxAniso])

  // try to upgrade to real card art (composited onto a canvas so it gets rounded corners)
  useEffect(() => {
    let alive = true
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
  }, [card.id, card.name, maxAniso])

  const tex = art ?? fallback

  // flat on table, rotated 90° when tapped; or standing toward camera
  const rot: [number, number, number] = standing
    ? [0, 0, 0]
    : [-Math.PI / 2, 0, card.tapped ? -Math.PI / 2 : 0]
  const lift = hover ? 0.7 : 0
  const scale = hover ? 1.35 : 1
  const glow = highlight === 'play' ? '#21e6ff' : highlight === 'target' ? '#ff2e97' : '#ffffff'
  // Fixed y for hit detection — does not move when card lifts on hover.
  // Keeping the interactive mesh stable prevents the feedback loop where lifting
  // moves the geometry out from under the pointer, firing onPointerLeave, dropping
  // the card, firing onPointerEnter again, etc. — which was flashing the preview.
  const hitY = standing ? CARD_H / 2 : 0.02

  return (
    <group position={position}>
      {/* Invisible stable hit area: stays at the original y regardless of hover state.
          Pointer events are handled here; the visual content is a separate group. */}
      <mesh
        position={[0, hitY, 0]}
        rotation={rot}
        userData={{ cardId: card.id }}
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
          <meshBasicMaterial map={tex} color={card.tapped && !standing ? '#7a7a82' : '#ffffff'} toneMapped={false} transparent depthWrite={false} />
        </mesh>

        {/* crisp DOM indicators anchored to the card — readable at any zoom/angle */}
        {isType(card, /creature/i) && card.power != null && card.toughness != null && (
          <Html
            position={[CARD_W * 0.34, 0.14, CARD_H * 0.3]}
            center
            distanceFactor={9}
            zIndexRange={[20, 0]}
            occlude={occludeBadges}
            className="c3d-badge c3d-pt"
          >
            {card.power}/{card.toughness}
          </Html>
        )}
        {isType(card, /planeswalker/i) && card.loyalty != null && (
          <Html
            position={[CARD_W * 0.34, 0.14, CARD_H * 0.3]}
            center
            distanceFactor={9}
            zIndexRange={[20, 0]}
            occlude={occludeBadges}
            className="c3d-badge c3d-loy"
          >
            {card.loyalty}
          </Html>
        )}
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
  return items.map(({ card, stackCount, members }, i) => ({
    card,
    stackCount,
    members,
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

/** Standard MTG battlefield layout in a seat's LOCAL space: creatures in a front
 *  row (toward centre, local -z), non-land permanents + grouped land stacks in a back row (+z).
 *  Same-named lands collapse into a single slot (Arena-style) to reduce crowding. */
function battlefieldLayout(player: GamePlayer): { card: GameCard; pos: [number, number, number]; stackCount?: number }[] {
  const creatures: RowItem[] = []
  const nonlands: RowItem[] = []
  const lands: GameCard[] = []
  for (const c of player.battlefield) {
    const t = (c.types ?? []).map((x) => x.toLowerCase())
    if (t.some((x) => x.includes('creature'))) creatures.push({ card: c })
    else if (t.some((x) => x.includes('land'))) lands.push(c)
    else nonlands.push({ card: c })
  }
  const landItems = groupLands(lands)
  return [...row(creatures, 0, -0.95), ...row([...nonlands, ...landItems], 0, 0.95)]
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

const MAT_W = 14.6
const MAT_H = 7.6 // deep enough for three rows (creatures · others · lands)
const MAT_Z = 0.35 // pushed slightly toward the player's back row
// Everything that "sits on the table" (playmats + their cards, the centre rings,
// the active-seat glow, the hand) is lifted by this much so the whole play layer
// floats above the bare table surface as one consistent plane.
const TABLE_LIFT = 0.09

/** A subtle playmat under a seat's zone: a dark fill + a thin coloured frame, so
 *  each player's area reads as one tidy region instead of cards floating loose. */
function SeatMat({ color, active }: { color: string; active: boolean }) {
  const fill = useMemo(() => new THREE.ShapeGeometry(roundedRectShape(MAT_W, MAT_H, 0.5)), [])
  const frame = useMemo(() => new THREE.ShapeGeometry(roundedRectShape(MAT_W + 0.18, MAT_H + 0.18, 0.56)), [])
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
  occludeBadges,
}: {
  seat: Seat
  active: boolean
  matColor: string
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  onOpenMenu?: (c: GameCard, members?: GameCard[]) => void
  occludeBadges?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const { placed, rows } = useMemo(() => {
    const creatures: RowItem[] = []
    const others: RowItem[] = [] // artifacts, enchantments, planeswalkers, …
    const lands: GameCard[] = []
    for (const c of seat.player.battlefield) {
      const t = (c.types ?? []).map((x) => x.toLowerCase())
      if (t.some((x) => x.includes('creature'))) creatures.push({ card: c })
      else if (t.some((x) => x.includes('land'))) lands.push(c)
      else others.push({ card: c })
    }
    const landRow = groupLands(lands)
    // Standard MTG table layout, front (toward combat) → back (near the player):
    //   creatures · non-creature permanents · lands.
    // The middle row only appears when there are other permanents, so a plain
    // creature+land board keeps its roomy two-row spacing.
    const defs = others.length
      ? [
          { items: creatures, z: -1.2 },
          { items: others, z: 0.3 },
          { items: landRow, z: 1.75 },
        ]
      : [
          { items: creatures, z: -0.95 },
          { items: landRow, z: 0.95 },
        ]
    const rows = defs.map((d) => {
      const overflow = Math.max(0, d.items.length - MAX_PER_ROW)
      const vis = expanded ? d.items : d.items.slice(0, MAX_PER_ROW)
      return { placed: row(vis, 0, d.z), overflow, visCount: vis.length, z: d.z }
    })
    return { placed: rows.flatMap((r) => r.placed), rows }
  }, [seat.player.battlefield, expanded])
  const anyOverflow = rows.some((r) => r.overflow > 0)

  const p = seat.player
  const gy = p.graveyard.length ? p.graveyard[p.graveyard.length - 1] : null
  const ex = p.exile.length ? p.exile[p.exile.length - 1] : null

  // X position of the overflow badge: one gap-width past the last visible card.
  // Uses the same capped-gap formula as row() so the badge lines up correctly
  // even when MAX_ROW_W forces cards to compress.
  const overflowX = (n: number) => {
    if (n <= 0) return 0
    const g = n > 1 ? Math.min(1.45, MAX_ROW_W / (n - 1)) : 1.45
    return ((n - 1) * g) / 2 + g
  }

  return (
    <group position={[seat.x, TABLE_LIFT, seat.z]} rotation={[0, seat.yaw, 0]}>
      <SeatMat color={matColor} active={active} />
      {placed.map(({ card, pos, stackCount, members }) => (
        <Card3D key={card.id} card={card} position={pos} stackCount={stackCount} members={members} cardProps={cardProps} onHoverCard={onHoverCard} onOpenMenu={onOpenMenu} occludeBadges={occludeBadges} />
      ))}
      {/* overflow badges: show +N when a row is clipped */}
      {!expanded &&
        rows.map((r, i) =>
          r.overflow > 0 ? (
            <Html key={i} position={[overflowX(r.visCount), 0.2, r.z]} center distanceFactor={10} zIndexRange={[20, 0]}>
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
          PILE_X keeps piles clear of the MAX_ROW_W battlefield rows. */}
      <CardPile position={[PILE_X, 1.7]} count={p.libraryCount} faceUp={false} label="Lib" cardProps={cardProps} onHoverCard={onHoverCard} occludeBadges={occludeBadges} />
      <CardPile position={[PILE_X, 0.0]} count={p.graveyardCount} top={gy} faceUp label="GY" cardProps={cardProps} onHoverCard={onHoverCard} occludeBadges={occludeBadges} />
      <CardPile position={[-PILE_X, 1.7]} count={p.exile.length} top={ex} faceUp label="Exile" cardProps={cardProps} onHoverCard={onHoverCard} occludeBadges={occludeBadges} />
    </group>
  )
}

/** Seat N players radially around the table: the viewer at the front (+z) and
 *  the rest spread evenly around the circle, each facing the centre. Scales the
 *  radius up with the player count so seats don't crowd. */
function seatPlayers(players: GamePlayer[], me?: string | null): { seats: Seat[]; radius: number; spectating: boolean } {
  const found = players.findIndex((p) => p.name === me)
  const spectating = found < 0 // me isn't a player → watching, so nobody is "You"
  const viewerIdx = spectating ? 0 : found
  // when spectating, keep natural seat order; otherwise pull the viewer to the front
  const ordered = spectating ? players : [players[viewerIdx], ...players.filter((_, i) => i !== viewerIdx)]
  const n = ordered.length
  // push seats further apart as the table fills so a busy multiplayer board has
  // breathing room (an 8.8-wide playmat needs the seats well separated)
  const radius = Math.max(4.3, 2.5 + n * 1.35)
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

function CameraRig({ target }: { target: ViewTarget }) {
  const { camera } = useThree()
  const look = useRef(new THREE.Vector3(0, 0, 0))
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

/** Cinematic auto-camera: orbits around the table to settle behind whoever's
 *  turn it is, with a slow "alive" drift, and during combat eases in toward the
 *  centre. With no active player it slowly circles the whole table. The angle is
 *  interpolated along the shortest arc so a turn change swooshes around the rim
 *  rather than cutting straight across. */
function CinematicRig({
  seats,
  activeName,
  radius,
  zoom,
  combat,
}: {
  seats: Seat[]
  activeName?: string | null
  radius: number
  zoom: number
  combat: number
}) {
  const { camera } = useThree()
  const look = useRef(new THREE.Vector3(0, 0.5, 0))
  const cyl = useRef({ theta: Math.PI / 2, r: radius + 5, y: 6.5 })
  const clock = useRef(0)

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05) // clamp after tab-switch stalls
    clock.current += dt
    const seat = seats.find((s) => s.player.name === activeName)

    // combat pushes the framing in toward the centre of the table for drama
    const combatPull = combat > 0 ? 0.78 : 1

    let targetTheta: number
    let lookTarget: THREE.Vector3
    if (seat) {
      targetTheta = Math.atan2(seat.z, seat.x) // camera sits outside the active seat
      lookTarget = new THREE.Vector3(seat.x * 0.32 * combatPull, 0.5, seat.z * 0.32 * combatPull)
    } else {
      // no active player (pre-game / overview) → slow continuous circle
      targetTheta = cyl.current.theta + 0.5
      lookTarget = new THREE.Vector3(0, 0.5, 0)
    }
    const targetR = ((radius + 5.8) / zoom) * combatPull
    const targetY = (seat ? 7.1 : 9) / Math.sqrt(zoom)

    // shortest-arc angle lerp → swoosh around the rim
    let dTheta = targetTheta - cyl.current.theta
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI
    cyl.current.theta += dTheta * Math.min(1, dt * (seat ? 1.7 : 0.3))
    cyl.current.r += (targetR - cyl.current.r) * Math.min(1, dt * 2.4)
    cyl.current.y += (targetY - cyl.current.y) * Math.min(1, dt * 2.4)

    // gentle alive drift so a settled camera never feels frozen
    const driftTheta = cyl.current.theta + Math.sin(clock.current * 0.22) * 0.05
    const driftY = cyl.current.y + Math.sin(clock.current * 0.4) * 0.22
    camera.position.set(Math.cos(driftTheta) * cyl.current.r, driftY, Math.sin(driftTheta) * cyl.current.r)

    look.current.lerp(lookTarget, Math.min(1, dt * 2.2))
    camera.lookAt(look.current)
  })
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

const ARROW_COLOR: Record<string, string> = { attack: '#ff3b3b', block: '#ffb13b', target: '#3bd6ff' }

/** A single arced 3D arrow (tube shaft + cone head) from `from` to `to`. */
function Arrow({ from, to, kind }: { from: THREE.Vector3; to: THREE.Vector3; kind: string }) {
  const { tube, headPos, headQuat } = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5)
    mid.y += from.distanceTo(to) * 0.22 + 0.6 // arc up so it reads over the cards
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const tube = new THREE.TubeGeometry(curve, 24, 0.055, 8, false)
    const tan = curve.getTangentAt(1).normalize()
    const headQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan)
    const headPos = to.clone().addScaledVector(tan, -0.18)
    return { tube, headPos, headQuat }
  }, [from, to])
  useEffect(() => () => tube.dispose(), [tube])
  const color = ARROW_COLOR[kind] ?? '#ffffff'
  return (
    <group userData={{ arrowKind: kind, arrowHead: headPos.toArray() }}>
      <mesh geometry={tube}>
        <meshBasicMaterial color={color} transparent opacity={0.92} toneMapped={false} depthTest={false} />
      </mesh>
      <mesh position={headPos} quaternion={headQuat}>
        <coneGeometry args={[0.17, 0.42, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} depthTest={false} />
      </mesh>
    </group>
  )
}

/** Arena/xmage-style action arrows: attackers→defender, blockers→attacker, and
 *  (when targeting) the stack→each selected target. Derived from combat + prompt. */
function BoardArrows({ seats, combat, targets }: { seats: Seat[]; combat: GameState['combat']; targets?: string[] }) {
  const arrows = useMemo(() => {
    // id → world position: battlefield cards by id, plus each player's seat centre
    const pos = new Map<string, THREE.Vector3>()
    for (const s of seats) {
      for (const { card, pos: lp } of battlefieldLayout(s.player)) pos.set(card.id, seatToWorld(s, lp))
      const centre = new THREE.Vector3(s.x * 0.8, 0.6, s.z * 0.8)
      pos.set('P:' + s.player.id, centre)
      pos.set('P:' + s.player.name, centre)
    }
    const out: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = []
    for (const cg of combat) {
      const defPos = cg.defender ? pos.get('P:' + cg.defender) ?? pos.get(cg.defender) : null
      for (const aid of cg.attackers) {
        const ap = pos.get(aid)
        if (ap && defPos) out.push({ from: ap, to: defPos, kind: 'attack' })
        if (ap) {
          for (const bid of cg.blockers) {
            const bp = pos.get(bid)
            if (bp) out.push({ from: bp, to: ap, kind: 'block' })
          }
        }
      }
    }
    if (targets && targets.length) {
      const src = new THREE.Vector3(0, 1.0, 0) // the stack, centre of the table
      for (const t of targets) {
        const tp = pos.get(t) ?? pos.get('P:' + t)
        if (tp) out.push({ from: src, to: tp, kind: 'target' })
      }
    }
    return out
  }, [seats, combat, targets])

  return (
    <>
      {arrows.map((a, i) => (
        <Arrow key={i} from={a.from} to={a.to} kind={a.kind} />
      ))}
    </>
  )
}

type ViewMode = '3d' | '2d' | 'free' | 'auto'

const ZOOM_MIN = 0.35
const ZOOM_MAX = 3.0
const ZOOM_STEP = 0.25
const ZOOM_DEFAULT = 0.75

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
      const out: { id: string; x: number; y: number; onScreen: boolean; tapped: boolean }[] = []
      three.scene.traverse((o) => {
        const id = o.userData?.cardId as string | undefined
        if (!id) return
        const wp = new THREE.Vector3()
        o.getWorldPosition(wp)
        const p = project(wp)
        out.push({
          id,
          x: p.x,
          y: p.y,
          onScreen: p.z < 1 && p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h,
          tapped: Math.abs((o as THREE.Object3D).rotation.z) > 0.5,
        })
      })
      return out
    }
    const api = {
      mode: () => ref.current.mode,
      zoom: () => ref.current.zoom,
      rendered,
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
 *  Camera row (Auto/3D/2D/Free) and, in 3D, a Focus row (Overview + each seat). */
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
  const focusItems: Item[] =
    mode === '3d'
      ? views.map((v, i) => ({ key: 'f-' + i, label: v.name, active: view === i, cat: 'focus', onClick: () => setView(i) }))
      : []

  return (
    <div className={`view-menu${open ? ' open' : ''}`}>
      <button className="view-fab" onClick={() => setOpen((o) => !o)} title="View options" aria-label="View options">
        {open ? '✕' : '⊙'}
      </button>
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
  targets,
  focusSeat,
}: {
  game: GameState
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  onOpenMenu?: (c: GameCard, members?: GameCard[]) => void
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
  const { seats, radius, spectating } = useMemo(() => seatPlayers(game.players, game.me), [game.players, game.me])

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
  const isMobile = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (max-height: 540px)').matches,
    [],
  )
  // Small screens default to free mode: a flat top-down board you pan with one
  // finger and pinch to zoom — a large zoomable/pannable canvas (rotate locked).
  const [mode, setMode] = useState<ViewMode>(() => (isMobile ? 'free' : prefs.defaultCamera))
  const TOP_DOWN: ViewTarget = useMemo(
    () => ({ pos: new THREE.Vector3(0, 15 + seats.length * 0.8, 2.2), look: new THREE.Vector3(0, 0, 0) }),
    [seats.length],
  )
  // spectators start on the overview; players start behind their own seat
  const [view, setView] = useState(spectating ? 0 : 1)
  useEffect(() => {
    if (view >= views.length) setView(spectating ? 0 : 1)
  }, [views.length, view, spectating])

  // clicking a player in the strip swings the manual 3D camera to their seat
  useEffect(() => {
    if (!focusSeat) return
    const idx = seats.findIndex((s) => s.player.name === focusSeat.name)
    if (idx >= 0) {
      setMode('3d')
      setView(idx + 1) // views[0] is Overview, then one per seat in `seats` order
    }
  }, [focusSeat, seats])

  const [zoom, setZoom] = useState(() => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prefs.boardZoom || ZOOM_DEFAULT)))

  const rawTarget = mode === '2d' ? TOP_DOWN : views[view].target
  // free mode uses OrbitControls scroll-wheel zoom; for 3d/2d we scale the camera distance
  const target = mode === 'free' ? rawTarget : applyZoom(rawTarget, zoom)

  // the hand is no longer laid on the table — it's a fixed screen-space fan at the
  // bottom of the screen (HandFan in GameTable), the way other MTG clients do it
  const stack = useMemo(() => row(game.stack.map((c) => ({ card: c })), 0, 0.6, 1.4), [game.stack])
  // only raycast-occlude DOM badges when there's a central stack to hide them behind;
  // the rest of the time it just risks per-frame badge flicker for no benefit
  const occludeBadges = game.stack.length > 0

  return (
    <div className="board3d">
      <ViewMenu mode={mode} setMode={setMode} views={views} view={view} setView={setView} />
      {mode !== 'free' && <ZoomBar zoom={zoom} onZoom={setZoom} />}
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

        {/* play surface: a dark pad with a glowing perimeter in the family colours */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[20, 15.5]} />
          <meshStandardMaterial color={scene.table} roughness={0.6} metalness={0.2} transparent opacity={scene.grid ? 0.62 : 0.92} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TABLE_LIFT - 0.012, 0]}>
          <circleGeometry args={[6.9, 64]} />
          <meshBasicMaterial color={scene.ring2} transparent opacity={0.06} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TABLE_LIFT - 0.01, 0]}>
          <ringGeometry args={[6.7, 6.9, 96]} />
          <meshBasicMaterial color={scene.ring} transparent opacity={0.38} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TABLE_LIFT - 0.008, 0]}>
          <ringGeometry args={[3.0, 3.08, 96]} />
          <meshBasicMaterial color={scene.ring2} transparent opacity={0.16} toneMapped={false} />
        </mesh>

        {seats.map((s) => (
          <PlayerZone
            key={s.player.id}
            seat={s}
            active={s.player.name === game.activePlayer}
            matColor={s.isViewer ? scene.ring : scene.ring2}
            cardProps={cardProps}
            onHoverCard={onHoverCard}
            onOpenMenu={onOpenMenu}
            occludeBadges={occludeBadges}
          />
        ))}

        {/* highlight whose turn it is */}
        {(() => {
          const active = seats.find((s) => s.player.name === game.activePlayer)
          return active ? <ActiveSeatGlow seat={active} /> : null
        })()}

        {/* action-direction arrows: attackers→defender, blockers→attacker, targeting */}
        <BoardArrows seats={seats} combat={game.combat} targets={targets} />

        {/* stack (center) — a full Billboard squares each card to the camera like an
            old billboard sprite (no axis locks), floated above the table and oversized
            so the spell(s) currently resolving read clearly from any seat. */}
        {stack.map(({ card, pos }, i) => {
          // the middle card(s) sit closest to the camera and biggest; outer ones
          // step back + down a touch so a multi-spell stack still fans readably.
          const mid = (stack.length - 1) / 2
          const off = Math.abs(i - mid)
          const scale = 1.5 - off * 0.18
          return (
            <Billboard key={card.id} position={[pos[0] * 1.3, TABLE_LIFT + 0.55 - off * 0.12, 0]} scale={scale}>
              <Card3D card={card} position={[0, 0, 0]} standing showCost cardProps={cardProps} onHoverCard={onHoverCard} onOpenMenu={onOpenMenu} />
            </Billboard>
          )
        })}

        {/* free cam → user orbits/pans; otherwise the camera is driven to the
            selected (2D top-down or 3D seat) viewpoint */}
        {mode === 'free' ? (
          <OrbitControls
            makeDefault
            enablePan
            enableDamping
            dampingFactor={0.08}
            minDistance={1.5}
            maxDistance={isMobile ? 60 : 40}
            target={[0, 0, 0]}
            // mobile = a flat pan/pinch canvas: one finger pans, two pinch-zoom,
            // rotation locked so the board stays readable top-down
            enableRotate={!isMobile}
            touches={isMobile ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : undefined}
          />
        ) : mode === 'auto' ? (
          <CinematicRig seats={seats} activeName={game.activePlayer} radius={radius} zoom={zoom} combat={game.combat.length} />
        ) : (
          <CameraRig target={target} />
        )}

        {/* readonly test instrumentation (window.__board3d) — see BoardDebug */}
        <BoardDebug zoom={zoom} mode={mode} look={mode === 'free' ? null : target.look} />
      </Canvas>
    </div>
  )
}
