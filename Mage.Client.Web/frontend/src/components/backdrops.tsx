import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { BackdropKind } from '../prefs'
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

/** Per-family 3D environment. `inGame` nudges placement for the board camera. */
export function FamilyBackdrop({ kind, inGame = false }: { kind: BackdropKind; inGame?: boolean }) {
  switch (kind) {
    case 'mythic':
      return (
        <>
          <Orb position={inGame ? [10, 14, -40] : [9, 7, -22]} size={inGame ? 6 : 4} color="#f0e2b0" opacity={0.5} />
          <Drift count={420} colors={['#e8c35a', '#ff8a3d', '#c9762a']} size={0.16} speed={1.3} dir={1} sway={0.25} />
        </>
      )
    case 'noir':
      return (
        <>
          <Orb position={inGame ? [-14, 16, -42] : [-9, 8, -22]} size={inGame ? 5 : 3.4} color="#c9ccd2" opacity={0.32} />
          <Drift count={900} colors={['#aeb4c2', '#c9ccd2', '#8b9099']} size={0.07} speed={9} dir={-1} sway={0.04} opacity={0.5} additive={false} />
        </>
      )
    case 'cutesy':
      return (
        <>
          <Orb position={inGame ? [11, 13, -40] : [9, 6, -22]} size={inGame ? 6 : 4} color="#ffd6ee" opacity={0.4} />
          <Drift count={260} colors={['#ff9ed2', '#9be8d8', '#ffc6e6']} size={0.4} speed={0.7} dir={1} sway={0.5} opacity={0.55} additive={false} />
          <Drift count={120} colors={['#ffffff']} size={0.18} speed={0.5} dir={1} sway={0.6} opacity={0.5} />
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
