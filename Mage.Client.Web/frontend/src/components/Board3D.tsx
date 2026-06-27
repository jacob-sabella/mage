import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GameCard, GamePlayer, GameState } from '../types'

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

type CardProps = (c: GameCard) => { highlight?: 'play' | 'target'; onClick?: (c: GameCard) => void }

/** A single card as a textured plane; lies flat (battlefield) or stands (hand/stack). */
function Card3D({
  card,
  position,
  standing,
  cardProps,
}: {
  card: GameCard
  position: [number, number, number]
  standing?: boolean
  cardProps: CardProps
}) {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
  const { highlight, onClick } = cardProps(card)

  useEffect(() => {
    let alive = true
    new THREE.TextureLoader().load(
      imgUrl(card),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        if (alive) setTex(t)
        else t.dispose()
      },
      undefined,
      () => alive && setTex(null),
    )
    return () => {
      alive = false
    }
  }, [card.id, card.name])

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
        }}
        onPointerOut={() => setHover(false)}
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
          map={tex ?? undefined}
          color={tex ? '#ffffff' : bg(card.colors)}
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
}: {
  player: GamePlayer
  z: number
  cardProps: CardProps
}) {
  const cards = useMemo(() => row(player.battlefield, 0, z), [player.battlefield, z])
  return (
    <group>
      {cards.map(({ card, pos }) => (
        <Card3D key={card.id} card={card} position={pos} cardProps={cardProps} />
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

export function Board3D({ game, cardProps }: { game: GameState; cardProps: CardProps }) {
  // order players so the viewer is "near" (front), others across the table
  const players = game.players
  const viewerIdx = Math.max(0, players.findIndex((p) => p.name === game.me))
  const near = players[viewerIdx]
  const far = players.filter((_, i) => i !== viewerIdx)

  const seats: { player: GamePlayer; z: number }[] = [
    { player: near, z: 2.6 },
    ...far.map((p, i) => ({ player: p, z: -2.6 - i * 2 })),
  ]

  // camera viewpoints: an overview + one behind each seat
  const views: { name: string; target: ViewTarget }[] = [
    { name: 'Overview', target: { pos: new THREE.Vector3(0, 7.5, 7.2), look: new THREE.Vector3(0, 0, 0) } },
    ...seats.map((s) => ({
      name: s.player.name,
      target: {
        pos: new THREE.Vector3(0, 4.2, s.z + (s.z > 0 ? 4.4 : -4.4)),
        look: new THREE.Vector3(0, 0, s.z > 0 ? 0.5 : -0.5),
      },
    })),
  ]
  const [view, setView] = useState(1) // default: behind the viewer

  const hand = useMemo(() => row(game.myHand, 0, 5.2, 0.95), [game.myHand])
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
        camera={{ position: [0, 4.2, 7], fov: 50 }}
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
          <PlayerZone key={s.player.id} player={s.player} z={s.z} cardProps={cardProps} />
        ))}

        {/* stack (standing, center) */}
        {stack.map(({ card, pos }) => (
          <Card3D key={card.id} card={card} position={[pos[0], 0, 0]} standing cardProps={cardProps} />
        ))}

        {/* my hand (standing, near camera) */}
        {hand.map(({ card, pos }) => (
          <Card3D key={card.id} card={card} position={pos} standing cardProps={cardProps} />
        ))}

        <CameraRig target={views[view].target} />
      </Canvas>
    </div>
  )
}
