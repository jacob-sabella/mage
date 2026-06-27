import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { GameCard, GamePlayer, GameState } from '../types'

/** Parse a mana-cost string like "{2}{R}{R}" into symbol tokens. */
function manaSymbols(cost?: string | null): string[] {
  if (!cost) return []
  return (cost.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
}
const MANA_PIP: Record<string, string> = { W: '#e9e3c0', U: '#4a90e2', B: '#6b5b73', R: '#e0555f', G: '#3aa55f' }
const isType = (c: GameCard, re: RegExp) => (c.types ?? []).some((t) => re.test(t))

const CARD_W = 1
const CARD_H = 1.4
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

  // always-present readable face; disposed on unmount
  const fallback = useMemo(() => makeCardTexture(card), [card.id, card.name, card.power, card.toughness, card.loyalty])
  useEffect(() => () => fallback.dispose(), [fallback])

  // try to upgrade to real card art
  useEffect(() => {
    let alive = true
    new THREE.TextureLoader().load(
      imgUrl(card),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        if (alive) setArt(t)
        else t.dispose()
      },
      undefined,
      () => alive && setArt(null),
    )
    return () => {
      alive = false
    }
  }, [card.id, card.name])

  const tex = art ?? fallback

  // flat on table, rotated 90° when tapped; or standing toward camera
  const rot: [number, number, number] = standing
    ? [0, 0, 0]
    : [-Math.PI / 2, 0, card.tapped ? -Math.PI / 2 : 0]
  const lift = hover ? 0.35 : 0
  const glow = highlight === 'play' ? '#2dd4bf' : highlight === 'target' ? '#5b8cff' : '#000'

  return (
    <group position={position}>
      <mesh
        position={[0, lift + (standing ? CARD_H / 2 : 0.01), 0]}
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
        scale={hover ? 1.12 : 1}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshStandardMaterial
          map={tex}
          color="#ffffff"
          side={THREE.DoubleSide}
          emissive={glow}
          emissiveIntensity={highlight ? (hover ? 0.9 : 0.55) : 0}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {highlight && (
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[CARD_W * 0.75, CARD_W * 0.92, 32]} />
          <meshBasicMaterial color={glow} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

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
function row(cards: GameCard[], cx: number, cz: number, gap = 1.15) {
  const w = (cards.length - 1) * gap
  return cards.map((c, i) => ({ card: c, pos: [cx - w / 2 + i * gap, 0, cz] as [number, number, number] }))
}

function PlayerZone({
  player,
  z,
  cardProps,
  onHoverCard,
}: {
  player: GamePlayer
  z: number
  cardProps: CardProps
  onHoverCard?: (c: GameCard | null) => void
}) {
  const cards = useMemo(() => row(player.battlefield, 0, z), [player.battlefield, z])
  return (
    <group>
      {cards.map(({ card, pos }) => (
        <Card3D key={card.id} card={card} position={pos} cardProps={cardProps} onHoverCard={onHoverCard} />
      ))}
    </group>
  )
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
  // order players so the viewer is "near" (front), others across the table
  const players = game.players
  const viewerIdx = Math.max(0, players.findIndex((p) => p.name === game.me))
  const near = players[viewerIdx]
  const far = players.filter((_, i) => i !== viewerIdx)

  const seats: { player: GamePlayer; z: number }[] = [
    { player: near, z: 2.6 },
    ...far.map((p, i) => ({ player: p, z: -2.6 - i * 2 })),
  ]

  // camera viewpoints: an overview + a 3/4 view behind each seat that frames
  // that player's battlefield and (for the viewer) the hand laid in front.
  const views: { name: string; target: ViewTarget }[] = [
    { name: 'Overview', target: { pos: new THREE.Vector3(0, 11, 8.5), look: new THREE.Vector3(0, 0, 0) } },
    ...seats.map((s) => {
      const sign = s.z > 0 ? 1 : -1
      return {
        name: s.player.name,
        target: {
          pos: new THREE.Vector3(0, 7.2, s.z + sign * 8),
          look: new THREE.Vector3(0, 0, s.z + sign * 1.5),
        },
      }
    }),
  ]
  const [view, setView] = useState(1) // default: behind the viewer

  const hand = useMemo(() => row(game.myHand, 0, 6.2, 1.2), [game.myHand])
  const stack = useMemo(() => row(game.stack, 0, 0, 1.1), [game.stack])

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
        camera={{ position: [0, 7.2, 10.6], fov: 50 }}
        dpr={[1, 1.8]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#0e1016']} />
        <fog attach="fog" args={['#0e1016', 16, 30]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 10, 6]} intensity={1.1} castShadow />
        <directionalLight position={[-6, 6, -4]} intensity={0.4} color="#5b8cff" />

        {/* table */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[16, 13]} />
          <meshStandardMaterial color="#16321f" roughness={0.95} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <ringGeometry args={[4.6, 4.85, 64]} />
          <meshBasicMaterial color="#2dd4bf" transparent opacity={0.18} />
        </mesh>

        {seats.map((s) => (
          <PlayerZone key={s.player.id} player={s.player} z={s.z} cardProps={cardProps} onHoverCard={onHoverCard} />
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
