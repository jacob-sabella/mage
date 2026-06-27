import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html } from '@react-three/drei'
import { FamilyBackdrop } from './backdrops'
import { usePrefs, CHROMA_FAMILY } from '../prefs'

// per-family in-game scene tint (background, fog, table, grid on/off)
const SCENE: Record<string, { bg: string; table: string; ring: string; ring2: string; grid: boolean; gridA: string; gridB: string; key: string; fill: string }> = {
  vapor:  { bg: '#0a0118', table: '#150a30', ring: '#ff2e97', ring2: '#21e6ff', grid: true,  gridA: '#7a2c9e', gridB: '#ff2e97', key: '#ff4fb0', fill: '#21e6ff' },
  mythic: { bg: '#0c0a06', table: '#1c160c', ring: '#e8c35a', ring2: '#4fbf86', grid: false, gridA: '#4a3a1e', gridB: '#e8c35a', key: '#ffd98a', fill: '#e8c35a' },
  noir:   { bg: '#050506', table: '#14161a', ring: '#e23c3c', ring2: '#c9ccd2', grid: false, gridA: '#2a2d33', gridB: '#5a5f66', key: '#dfe2e8', fill: '#9aa0aa' },
  cutesy: { bg: '#2a1430', table: '#3a1c45', ring: '#ff9ed2', ring2: '#9be8d8', grid: false, gridA: '#6b4080', gridB: '#ff9ed2', key: '#ffc6e6', fill: '#9be8d8' },
}
import * as THREE from 'three'
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
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
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

type CardProps = (c: GameCard) => { highlight?: 'play' | 'target'; onClick?: (c: GameCard) => void }

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

  // try to upgrade to real card art
  useEffect(() => {
    let alive = true
    new THREE.TextureLoader().load(
      imgUrl(card),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = maxAniso // anisotropic filtering keeps angled cards crisp
        t.minFilter = THREE.LinearMipmapLinearFilter
        t.magFilter = THREE.LinearFilter
        t.needsUpdate = true
        if (alive) setArt(t)
        else t.dispose()
      },
      undefined,
      () => alive && setArt(null),
    )
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
  const yFace = lift + (standing ? CARD_H / 2 : 0.02)

  return (
    <group position={position}>
      {/* glowing backing plate for highlighted (playable/targetable) or hovered cards */}
      {(highlight || hover) && (
        <mesh position={[0, lift + (standing ? CARD_H / 2 : 0.012), standing ? -0.01 : 0]} rotation={rot} scale={scale}>
          <planeGeometry args={[CARD_W * 1.12, CARD_H * 1.1]} />
          <meshBasicMaterial color={glow} transparent opacity={hover ? 0.85 : 0.55} toneMapped={false} />
        </mesh>
      )}
      <mesh
        position={[0, yFace, 0]}
        rotation={rot}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
          onHoverCard?.(card)
        }}
        onPointerOut={() => {
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
        scale={scale}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        {/* unlit + toneMapped off → card art shows at full, vivid, readable colour
            instead of being washed out by the scene lighting */}
        <meshBasicMaterial map={tex} color="#ffffff" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* crisp DOM indicators anchored to the card — readable at any zoom/angle */}
      {isType(card, /creature/i) && card.power != null && card.toughness != null && (
        <Html
          position={[CARD_W * 0.34, lift + 0.14, CARD_H * 0.3]}
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
          position={[CARD_W * 0.34, lift + 0.14, CARD_H * 0.3]}
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
          position={[-CARD_W * 0.18, lift + 0.14, -CARD_H * 0.34]}
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
  )
}

/** Lay a row of cards centered at (cx, cz) along X. */
function row(cards: GameCard[], cx: number, cz: number, gap = 1.45) {
  const w = (cards.length - 1) * gap
  return cards.map((c, i) => ({ card: c, pos: [cx - w / 2 + i * gap, 0, cz] as [number, number, number] }))
}

type Seat = { player: GamePlayer; x: number; z: number; yaw: number; isViewer: boolean }

function PlayerZone({
  seat,
  cardProps,
  onHoverCard,
}: {
  seat: Seat
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
}) {
  // standard MTG layout in the seat's LOCAL space: creatures in a front row
  // (toward the centre, local -z) and lands + other permanents in a back row
  // (local +z). The whole group is rotated to face the table centre.
  const placed = useMemo(() => {
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
    return [...row(creatures, 0, -0.95), ...row(back, 0, 0.95)]
  }, [seat.player.battlefield])
  return (
    <group position={[seat.x, 0, seat.z]} rotation={[0, seat.yaw, 0]}>
      {placed.map(({ card, pos }) => (
        <Card3D key={card.id} card={card} position={pos} cardProps={cardProps} onHoverCard={onHoverCard} />
      ))}
    </group>
  )
}

/** Seat N players radially around the table: the viewer at the front (+z) and
 *  the rest spread evenly around the circle, each facing the centre. Scales the
 *  radius up with the player count so seats don't crowd. */
function seatPlayers(players: GamePlayer[], me?: string | null): { seats: Seat[]; radius: number } {
  const viewerIdx = Math.max(0, players.findIndex((p) => p.name === me))
  const ordered = [players[viewerIdx], ...players.filter((_, i) => i !== viewerIdx)]
  const n = ordered.length
  const radius = Math.max(2.9, 2.2 + n * 0.42)
  const seats = ordered.map((player, i) => {
    const theta = Math.PI / 2 + (i * 2 * Math.PI) / n // viewer at +z (front)
    return {
      player,
      x: radius * Math.cos(theta),
      z: radius * Math.sin(theta),
      yaw: Math.PI / 2 - theta, // rotate local -z to point at the centre
      isViewer: i === 0,
    }
  })
  return { seats, radius }
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

export function Board3D({
  game,
  cardProps,
  onHoverCard,
}: {
  game: GameState
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
}) {
  const { prefs } = usePrefs()
  const backdrop = CHROMA_FAMILY[prefs.theme]?.backdrop ?? 'vapor'
  const scene = SCENE[backdrop] ?? SCENE.vapor

  // seat all players radially around the table (supports 2..N)
  const { seats, radius } = useMemo(() => seatPlayers(game.players, game.me), [game.players, game.me])

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
        const out = radius + 4.8
        return {
          name: s.isViewer ? 'You' : s.player.name,
          target: {
            pos: new THREE.Vector3(ux * out, 5.4, uz * out),
            look: new THREE.Vector3(ux * 1.2, 0, uz * 1.2),
          },
        }
      }),
    ],
    [seats, radius],
  )
  const [view, setView] = useState(1) // default: behind the viewer
  // keep the selected view valid if the player count changes
  useEffect(() => {
    if (view >= views.length) setView(1)
  }, [views.length, view])

  const hand = useMemo(() => row(game.myHand, 0, 5.9, 1.42), [game.myHand])
  const stack = useMemo(() => row(game.stack, 0, 0.6, 1.4), [game.stack])

  return (
    <div className="board3d">
      <div className="view-bar">
        <span className="muted view-label">View:</span>
        {views.map((v, i) => (
          <button
            key={v.name}
            className={`btn view-btn${view === i ? ' active' : ''}`}
            onClick={() => setView(i)}
          >
            {v.name}
          </button>
        ))}
      </div>
      <Canvas
        shadows
        camera={{ position: [0, 5.4, 10 ], fov: 46 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        {/* the world is the active family's environment */}
        <color attach="background" args={[scene.bg]} />
        <fog attach="fog" args={[scene.bg, 34, 96]} />
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

        {/* stack (standing, center) */}
        {stack.map(({ card, pos }) => (
          <Card3D key={card.id} card={card} position={[pos[0], 0, 0]} standing showCost cardProps={cardProps} onHoverCard={onHoverCard} />
        ))}

        {/* my hand: laid flat in front of the viewer, slightly raised */}
        {hand.map(({ card, pos }) => (
          <Card3D key={card.id} card={card} position={[pos[0], 0.06, pos[2]]} showCost cardProps={cardProps} onHoverCard={onHoverCard} />
        ))}

        <CameraRig target={views[view].target} />
      </Canvas>
    </div>
  )
}
