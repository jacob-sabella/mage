import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Ambient 3D backdrop: a slowly drifting field of indigo/cyan motes with depth,
 * giving the app an atmospheric "game table in space" feel. Purely decorative
 * and non-interactive (pointer-events disabled), so a WebGL failure can't affect
 * gameplay — the Obsidian gradient still shows behind it.
 */
function Motes() {
  const ref = useRef<THREE.Points>(null)

  const { positions, colors } = useMemo(() => {
    const count = 1600
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const indigo = new THREE.Color('#5b8cff')
    const teal = new THREE.Color('#2dd4bf')
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 64
      positions[i * 3 + 1] = (Math.random() - 0.5) * 38
      positions[i * 3 + 2] = (Math.random() - 0.5) * 42 - 8
      const c = Math.random() < 0.5 ? indigo : teal
      const f = 0.35 + Math.random() * 0.65
      colors[i * 3 + 0] = c.r * f
      colors[i * 3 + 1] = c.g * f
      colors[i * 3 + 2] = c.b * f
    }
    return { positions, colors }
  }, [])

  useFrame((state, delta) => {
    const p = ref.current
    if (!p) return
    p.rotation.y += delta * 0.018
    p.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.06
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.13}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export function SceneBackground() {
  return (
    <div className="scene-bg" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 18], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <fog attach="fog" args={['#16181d', 22, 48]} />
        <Motes />
      </Canvas>
    </div>
  )
}
