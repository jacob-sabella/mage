import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import { usePrefs, CHROMA_FAMILY } from '../prefs'

// per-family in-game scene tint (background, fog, table, grid on/off)
const SCENE: Record<string, { bg: string; table: string; ring: string; ring2: string; grid: boolean; gridA: string; gridB: string; key: string; fill: string }> = {
  vapor:  { bg: '#0a0118', table: '#150a30', ring: '#ff2e97', ring2: '#21e6ff', grid: true,  gridA: '#7a2c9e', gridB: '#ff2e97', key: '#ff4fb0', fill: '#21e6ff' },
  mythic: { bg: '#0c0a06', table: '#1c160c', ring: '#e8c35a', ring2: '#4fbf86', grid: false, gridA: '#4a3a1e', gridB: '#e8c35a', key: '#ffd98a', fill: '#e8c35a' },
  noir:   { bg: '#050506', table: '#14161a', ring: '#e23c3c', ring2: '#c9ccd2', grid: false, gridA: '#2a2d33', gridB: '#5a5f66', key: '#dfe2e8', fill: '#9aa0aa' },
  cutesy: { bg: '#2a1430', table: '#3a1c45', ring: '#ff9ed2', ring2: '#9be8d8', grid: false, gridA: '#6b4080', gridB: '#ff9ed2', key: '#ffc6e6', fill: '#9be8d8' },
  space:  { bg: '#02030a', table: '#0a1024', ring: '#b14bff', ring2: '#4bd6ff', grid: false, gridA: '#1a2348', gridB: '#4bd6ff', key: '#cdd6ff', fill: '#6b8cff' },
}
import * as THREE from 'three'
import type { GameCard, GamePlayer, GameState } from '../types'
import { FamilyBackdrop } from './backdrops'

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
 *  Zone piles sit at x ≈ ±3.0, so this keeps cards comfortably between them and
 *  prevents battlefield rows from overflowing into neighbouring players' zones. */
const MAX_ROW_W = 4.8
const MAX_PER_ROW = 12
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
}: {
  position: [number, number] // local x, z
  count: number
  top?: GameCard | null
  faceUp: boolean
  label: string
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
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
          <meshBasicMaterial map={back} toneMapped={false} transparent />
        </mesh>
      ))}
      {/* top of the pile */}
      {count > 0 &&
        (faceUp && top ? (
          <Card3D card={top} position={[0, topY, 0]} cardProps={cardProps} onHoverCard={onHoverCard} />
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, topY, 0]}>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial map={back} toneMapped={false} transparent />
          </mesh>
        ))}
      <Html position={[0, 0.34, CARD_H * 0.62]} center distanceFactor={10} zIndexRange={[15, 0]} className="c3d-badge c3d-zone">
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
  cardProps,
  onHoverCard,
}: {
  card: GameCard
  position: [number, number, number]
  standing?: boolean
  showCost?: boolean
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
}) {
  const [art, setArt] = useState<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
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
    const img = new Image()
    img.crossOrigin = 'anonymous'
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
    img.src = imgUrl(card)
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
        onPointerEnter={(e) => {
          e.stopPropagation()
          setHover(true)
          onHoverCard?.(card)
        }}
        onPointerLeave={() => {
          setHover(false)
          onHoverCard?.(null)
        }}
        onClick={
          onClick
            ? (e) => {
                e.stopPropagation()
                onClick(card)
              }
            : undefined
        }
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
              instead of being washed out by the scene lighting */}
          <meshBasicMaterial map={tex} color="#ffffff" toneMapped={false} transparent />
        </mesh>

        {/* crisp DOM indicators anchored to the card — readable at any zoom/angle */}
        {isType(card, /creature/i) && card.power != null && card.toughness != null && (
          <Html
            position={[CARD_W * 0.34, 0.14, CARD_H * 0.3]}
            center
            distanceFactor={9}
            zIndexRange={[20, 0]}
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
            className="c3d-badge c3d-loy"
          >
            {card.loyalty}
          </Html>
        )}
        {showCost && manaSymbols(card.manaCost).length > 0 && (
          <Html
            position={[-CARD_W * 0.18, 0.14, -CARD_H * 0.34]}
            center
            distanceFactor={9}
            zIndexRange={[20, 0]}
            className="c3d-badge c3d-mana"
          >
            {manaSymbols(card.manaCost).map((s, i) => (
              <span key={i} className="c3d-pip" style={{ background: MANA_PIP[s] ?? '#9aa0ad' }}>
                {s}
              </span>
            ))}
          </Html>
        )}
      </group>
    </group>
  )
}

/** Lay a row of cards centered at (cx, cz) along X.
 *  When the row would exceed MAX_ROW_W the gap shrinks so cards overlap
 *  (Slay-the-Spire style) instead of spilling outside the player's zone. */
function row(cards: GameCard[], cx: number, cz: number, gap = 1.45) {
  const n = cards.length
  if (n === 0) return []
  // Cap the gap so the total row width never exceeds MAX_ROW_W.
  const effectiveGap = n > 1 ? Math.min(gap, MAX_ROW_W / (n - 1)) : gap
  const w = (n - 1) * effectiveGap
  // Tiny per-card y stagger prevents coplanar z-fighting when adjacent cards share
  // edge pixels under MSAA — visually imperceptible at this scale.
  return cards.map((c, i) => ({ card: c, pos: [cx - w / 2 + i * effectiveGap, i * 0.0002, cz] as [number, number, number] }))
}

type Seat = { player: GamePlayer; x: number; z: number; yaw: number; isViewer: boolean }

/** Standard MTG battlefield layout in a seat's LOCAL space: creatures in a front
 *  row (toward centre, local -z), lands + other permanents in a back row (+z). */
function battlefieldLayout(player: GamePlayer): { card: GameCard; pos: [number, number, number] }[] {
  const creatures: GameCard[] = []
  const back: GameCard[] = []
  for (const c of player.battlefield) {
    const t = (c.types ?? []).map((x) => x.toLowerCase())
    if (t.some((x) => x.includes('creature'))) creatures.push(c)
    else back.push(c)
  }
  back.sort((a, b) => {
    const al = (a.types ?? []).some((x) => /land/i.test(x)) ? 0 : 1
    const bl = (b.types ?? []).some((x) => /land/i.test(x)) ? 0 : 1
    return al - bl
  })
  return [...row(creatures, 0, -0.95), ...row(back, 0, 0.95)]
}

/** World position of a seat-local point, applying the seat's yaw + translation. */
function seatToWorld(seat: Seat, local: [number, number, number], y = 0.35): THREE.Vector3 {
  const cos = Math.cos(seat.yaw)
  const sin = Math.sin(seat.yaw)
  const x = local[0]
  const z = local[2]
  return new THREE.Vector3(seat.x + (x * cos + z * sin), y, seat.z + (-x * sin + z * cos))
}

function PlayerZone({
  seat,
  cardProps,
  onHoverCard,
}: {
  seat: Seat
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const { placed, creatureOverflow, backOverflow, creatureVisCount, backVisCount } = useMemo(() => {
    const creatures: GameCard[] = []
    const back: GameCard[] = []
    for (const c of seat.player.battlefield) {
      const t = (c.types ?? []).map((x) => x.toLowerCase())
      if (t.some((x) => x.includes('creature'))) creatures.push(c)
      else back.push(c)
    }
    back.sort((a, b) => {
      const al = (a.types ?? []).some((x) => /land/i.test(x)) ? 0 : 1
      const bl = (b.types ?? []).some((x) => /land/i.test(x)) ? 0 : 1
      return al - bl
    })
    const creatureOverflow = Math.max(0, creatures.length - MAX_PER_ROW)
    const backOverflow = Math.max(0, back.length - MAX_PER_ROW)
    const visCreatures = expanded ? creatures : creatures.slice(0, MAX_PER_ROW)
    const visBack = expanded ? back : back.slice(0, MAX_PER_ROW)
    return {
      placed: [...row(visCreatures, 0, -0.95), ...row(visBack, 0, 0.95)],
      creatureOverflow,
      backOverflow,
      creatureVisCount: visCreatures.length,
      backVisCount: visBack.length,
    }
  }, [seat.player.battlefield, expanded])

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
    <group position={[seat.x, 0, seat.z]} rotation={[0, seat.yaw, 0]}>
      {placed.map(({ card, pos }) => (
        <Card3D key={card.id} card={card} position={pos} cardProps={cardProps} onHoverCard={onHoverCard} />
      ))}
      {/* overflow badges: show +N when a row is clipped */}
      {!expanded && creatureOverflow > 0 && (
        <Html position={[overflowX(creatureVisCount), 0.2, -0.95]} center distanceFactor={10} zIndexRange={[20, 0]}>
          <button className="c3d-overflow-btn" onClick={() => setExpanded(true)}>
            +{creatureOverflow}
          </button>
        </Html>
      )}
      {!expanded && backOverflow > 0 && (
        <Html position={[overflowX(backVisCount), 0.2, 0.95]} center distanceFactor={10} zIndexRange={[20, 0]}>
          <button className="c3d-overflow-btn" onClick={() => setExpanded(true)}>
            +{backOverflow}
          </button>
        </Html>
      )}
      {/* collapse button when all cards are shown */}
      {expanded && (creatureOverflow > 0 || backOverflow > 0) && (
        <Html position={[0, 0.3, -1.8]} center distanceFactor={10} zIndexRange={[20, 0]}>
          <button className="c3d-overflow-btn c3d-overflow-collapse" onClick={() => setExpanded(false)}>
            ▲ collapse
          </button>
        </Html>
      )}
      {/* zone piles — standard playmat: library + graveyard to the player's
          right, exile set apart on the left ("outside the game") */}
      <CardPile position={[3.0, 1.7]} count={p.libraryCount} faceUp={false} label="Lib" cardProps={cardProps} onHoverCard={onHoverCard} />
      <CardPile position={[3.0, 0.0]} count={p.graveyardCount} top={gy} faceUp label="GY" cardProps={cardProps} onHoverCard={onHoverCard} />
      <CardPile position={[-3.0, 1.7]} count={p.exile.length} top={ex} faceUp label="Exile" cardProps={cardProps} onHoverCard={onHoverCard} />
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
  const radius = Math.max(2.9, 2.2 + n * 0.42)
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
    camera.position.lerp(target.pos, 0.1)
    look.current.lerp(target.look, 0.1)
    camera.lookAt(look.current)
  })
  return null
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
    <group>
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

type ViewMode = '3d' | '2d' | 'free'

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
      <span className="zoom-label" title="Click to reset zoom" onClick={() => onZoom(ZOOM_DEFAULT)} style={{ cursor: 'pointer' }}>
        {Math.round(zoom * 100)}%
      </span>
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

/** Radial fan menu for camera control: a mode ring (2D/3D/Free) plus, in 3D, a
 *  focus ring (Overview + each seat). Collapsed to a single button by default. */
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
  const modeItems: Item[] = (['3d', '2d', 'free'] as ViewMode[]).map((m) => ({
    key: 'm-' + m,
    label: m === '3d' ? '3D' : m === '2d' ? '2D' : 'Free',
    active: mode === m,
    cat: 'mode',
    onClick: () => setMode(m),
  }))
  const focusItems: Item[] =
    mode === '3d'
      ? views.map((v, i) => ({ key: 'f-' + i, label: v.name, active: view === i, cat: 'focus', onClick: () => setView(i) }))
      : []
  // Fan into the board's down-right quadrant only (keeps items on-screen).
  // a1 is capped at 88° so cos(angle) stays positive — past 90° items would
  // translate leftward and disappear off the left edge of the screen.
  const a0 = 8
  const a1 = 88
  const rings = [
    { items: modeItems, R: 74 },
    { items: focusItems, R: 110 + focusItems.length * 10 },
  ].filter((g) => g.items.length)
  const placed = rings.flatMap((g) =>
    g.items.map((it, i) => {
      const t = g.items.length > 1 ? i / (g.items.length - 1) : 0.5
      const ang = ((a0 + (a1 - a0) * t) * Math.PI) / 180
      return { it, x: Math.cos(ang) * g.R, y: Math.sin(ang) * g.R }
    }),
  )

  return (
    <div className={`view-menu${open ? ' open' : ''}`}>
      <button className="view-fab" onClick={() => setOpen((o) => !o)} title="View options" aria-label="View options">
        {open ? '✕' : '⊙'}
      </button>
      {placed.map(({ it, x, y }) => (
        <button
          key={it.key}
          className={`btn view-btn view-radial ${it.cat}${it.active ? ' active' : ''}`}
          style={{
            transform: open ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` : 'translate(0,0) scale(0.4)',
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
          }}
          onClick={it.onClick}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Board3D({
  game,
  cardProps,
  onHoverCard,
  targets,
}: {
  game: GameState
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
  targets?: string[]
}) {
  const { prefs } = usePrefs()
  const chroma = CHROMA_FAMILY[prefs.theme]
  const backdrop = chroma?.backdrop ?? 'vapor'
  const baseScene = SCENE[backdrop] ?? SCENE.vapor
  const scene = { ...baseScene, ring: chroma?.a ?? baseScene.ring, ring2: chroma?.b ?? baseScene.ring2, gridB: chroma?.a ?? baseScene.gridB, key: chroma?.a ?? baseScene.key, fill: chroma?.b ?? baseScene.fill }

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
  // 2D = a fixed top-down lock on the table; 3D = the angled seat views; free =
  // user-orbited camera. The whole canvas is the world either way.
  const [mode, setMode] = useState<ViewMode>('3d')
  const TOP_DOWN: ViewTarget = useMemo(
    () => ({ pos: new THREE.Vector3(0, 15 + seats.length * 0.8, 2.2), look: new THREE.Vector3(0, 0, 0) }),
    [seats.length],
  )
  // spectators start on the overview; players start behind their own seat
  const [view, setView] = useState(spectating ? 0 : 1)
  useEffect(() => {
    if (view >= views.length) setView(spectating ? 0 : 1)
  }, [views.length, view, spectating])

  const [zoom, setZoom] = useState(ZOOM_DEFAULT)

  const rawTarget = mode === '2d' ? TOP_DOWN : views[view].target
  // free mode uses OrbitControls scroll-wheel zoom; for 3d/2d we scale the camera distance
  const target = mode === 'free' ? rawTarget : applyZoom(rawTarget, zoom)

  const hand = useMemo(() => row(game.myHand, 0, 5.9, 1.42), [game.myHand])
  const stack = useMemo(() => row(game.stack, 0, 0.6, 1.4), [game.stack])

  return (
    <div className="board3d">
      <ViewMenu mode={mode} setMode={setMode} views={views} view={view} setView={setView} />
      {mode !== 'free' && <ZoomBar zoom={zoom} onZoom={setZoom} />}
      <Canvas
        shadows
        camera={{ position: [0, 5.4, 10 ], fov: 46 }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        {/* Opaque canvas with the backdrop rendered inside so WebGL depth-sorting
            correctly occludes the background behind the 3D table and cards. */}
        <color attach="background" args={[scene.bg]} />
        <fog attach="fog" args={[scene.bg, 40, 80]} />
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
          <planeGeometry args={[15, 11.5]} />
          <meshStandardMaterial color={scene.table} roughness={0.6} metalness={0.2} transparent opacity={scene.grid ? 0.62 : 0.92} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
          <circleGeometry args={[5.2, 64]} />
          <meshBasicMaterial color={scene.ring2} transparent opacity={0.06} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <ringGeometry args={[5.05, 5.2, 96]} />
          <meshBasicMaterial color={scene.ring} transparent opacity={0.7} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, 0]}>
          <ringGeometry args={[3.0, 3.08, 96]} />
          <meshBasicMaterial color={scene.ring2} transparent opacity={0.45} toneMapped={false} />
        </mesh>

        {seats.map((s) => (
          <PlayerZone key={s.player.id} seat={s} cardProps={cardProps} onHoverCard={onHoverCard} />
        ))}

        {/* action-direction arrows: attackers→defender, blockers→attacker, targeting */}
        <BoardArrows seats={seats} combat={game.combat} targets={targets} />

        {/* stack (standing, center) */}
        {stack.map(({ card, pos }) => (
          <Card3D key={card.id} card={card} position={[pos[0], 0, 0]} standing showCost cardProps={cardProps} onHoverCard={onHoverCard} />
        ))}

        {/* my hand: laid flat in front of the viewer, slightly raised */}
        {hand.map(({ card, pos }) => (
          <Card3D key={card.id} card={card} position={[pos[0], 0.06, pos[2]]} showCost cardProps={cardProps} onHoverCard={onHoverCard} />
        ))}

        {/* free cam → user orbits/pans; otherwise the camera is driven to the
            selected (2D top-down or 3D seat) viewpoint */}
        {mode === 'free' ? (
          <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={40} target={[0, 0, 0]} />
        ) : (
          <CameraRig target={target} />
        )}
      </Canvas>
    </div>
  )
}
