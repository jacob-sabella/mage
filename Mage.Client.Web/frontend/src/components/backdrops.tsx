import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { BackdropKind } from '../prefs'
import { usePrefs, CHROMAS } from '../prefs'
import { SynthSun, SynthStars } from './SceneBackground'

/** Shared drifting-particle system. `dir` = +1 rise, -1 fall. */
function Drift({
  count,
  colors,
  size,
  speed,
  dir,
  spread = [54, 34, 40],
  yOffset = -6,
  sway = 0.2,
  additive = true,
  opacity = 0.9,
}: {
  count: number
  colors: string[]
  size: number
  speed: number
  dir: 1 | -1
  spread?: [number, number, number]
  yOffset?: number
  sway?: number
  additive?: boolean
  opacity?: number
}) {
  const ref = useRef<THREE.Points>(null)
  const { positions, colorBuf, vel } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colorBuf = new Float32Array(count * 3)
    const vel = new Float32Array(count)
    const cols = colors.map((c) => new THREE.Color(c))
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * spread[0]
      positions[i * 3 + 1] = Math.random() * spread[1] + yOffset
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread[2] - 6
      vel[i] = speed * (0.5 + Math.random())
      const c = cols[(Math.random() * cols.length) | 0]
      const f = 0.5 + Math.random() * 0.5
      colorBuf[i * 3 + 0] = c.r * f
      colorBuf[i * 3 + 1] = c.g * f
      colorBuf[i * 3 + 2] = c.b * f
    }
    return { positions, colorBuf, vel }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  useFrame((_, delta) => {
    const p = ref.current
    if (!p) return
    const arr = p.geometry.attributes.position.array as Float32Array
    const top = spread[1] + yOffset
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += dir * vel[i] * delta
      arr[i * 3 + 0] += Math.sin((arr[i * 3 + 1] + i) * 0.4) * delta * sway
      if (dir > 0 && arr[i * 3 + 1] > top) arr[i * 3 + 1] = yOffset
      if (dir < 0 && arr[i * 3 + 1] < yOffset) arr[i * 3 + 1] = top
    }
    p.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colorBuf, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        vertexColors
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  )
}

/** A lit 3D planet sphere with an optional tilted ring — for the Space family. */
function Planet({
  position,
  size,
  color,
  ring,
  ringColor = '#cdb',
}: {
  position: [number, number, number]
  size: number
  color: string
  ring?: boolean
  ringColor?: string
}) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.05
  })
  return (
    <group position={position}>
      {/* soft atmosphere halo */}
      <mesh>
        <sphereGeometry args={[size * 1.18, 24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[size, 36, 36]} />
        <meshStandardMaterial color={color} roughness={0.85} metalness={0.1} emissive={color} emissiveIntensity={0.12} />
      </mesh>
      {ring && (
        <mesh rotation={[Math.PI / 2.6, 0.2, 0]}>
          <ringGeometry args={[size * 1.45, size * 2.1, 64]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.4} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

/** A simple glowing disc (moon/orb) high in the scene. */
function Orb({ position, size, color, opacity = 0.5 }: { position: [number, number, number]; size: number; color: string; opacity?: number }) {
  return (
    <group position={position}>
      <mesh>
        <circleGeometry args={[size * 1.5, 48]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[size, 48]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Per-family 3D environment. `inGame` nudges placement for the board camera.
 *  Reads the active chroma so particle/planet colours follow the selected palette. */
export function FamilyBackdrop({ kind, inGame = false }: { kind: BackdropKind; inGame?: boolean }) {
  const { prefs } = usePrefs()
  const chroma = CHROMAS[prefs.theme] ?? CHROMAS.synthwave
  const a = chroma.a
  const b = chroma.b

  switch (kind) {
    case 'mythic':
      return (
        <>
          <Orb position={inGame ? [10, 14, -40] : [9, 7, -22]} size={inGame ? 6 : 4} color="#f0e2b0" opacity={0.5} />
          {/* ember colour follows the active chroma — crimson burns red, azure drifts blue */}
          <Drift key={`mythic-${chroma.id}`} count={420} colors={[a, '#ff8a3d', b]} size={0.16} speed={1.3} dir={1} sway={0.25} />
        </>
      )
    case 'noir':
      return (
        <>
          {/* searchlight tint takes the chroma accent — red classic, blue ice, etc. */}
          <Orb position={inGame ? [-14, 16, -42] : [-9, 8, -22]} size={inGame ? 5 : 3.4} color={a} opacity={0.28} />
          <Drift count={900} colors={['#aeb4c2', '#c9ccd2', '#8b9099']} size={0.07} speed={9} dir={-1} sway={0.04} opacity={0.5} additive={false} />
        </>
      )
    case 'cutesy':
      return (
        <>
          {/* orb + bubbles match the active pastel palette */}
          <Orb position={inGame ? [11, 13, -40] : [9, 6, -22]} size={inGame ? 6 : 4} color={a} opacity={0.42} />
          <Drift key={`cutesy-${chroma.id}`} count={260} colors={[a, b, '#ffc6e6']} size={0.4} speed={0.7} dir={1} sway={0.5} opacity={0.55} additive={false} />
          <Drift count={120} colors={['#ffffff']} size={0.18} speed={0.5} dir={1} sway={0.6} opacity={0.5} />
        </>
      )
    case 'space':
      return (
        <>
          {/* deep starfield */}
          <SynthStars count={inGame ? 1600 : 2200} />
          {/* planet colours follow the active chroma — Nebula gets purple, Mars gets orange */}
          <Planet key={`${chroma.id}-p1`} position={inGame ? [-16, 11, -44] : [-10, 6, -26]} size={inGame ? 4.6 : 3} color={a} ring ringColor={b} />
          <Planet key={`${chroma.id}-p2`} position={inGame ? [15, 15, -52] : [10, 9, -30]} size={inGame ? 2.6 : 1.8} color={b} />
          <Planet key={`${chroma.id}-p3`} position={inGame ? [6, -4, -40] : [4, -3, -22]} size={inGame ? 1.4 : 1} color={a} />
          {/* nebula dust in chroma colours */}
          <Drift key={`${chroma.id}-dust`} count={500} colors={[a, b]} size={0.6} speed={0.25} dir={1} sway={0.3} opacity={0.22} />
        </>
      )
    case 'vapor':
    default:
      return (
        <>
          <SynthSun position={inGame ? [0, 4, -46] : [0, -9, -20]} size={inGame ? 34 : 17} />
          <SynthStars count={inGame ? 900 : 1400} />
        </>
      )
  }
}
