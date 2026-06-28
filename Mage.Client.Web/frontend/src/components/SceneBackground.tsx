import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { usePrefs, CHROMA_FAMILY } from '../prefs'
import { FamilyBackdrop } from './backdrops'

/**
 * Synthwave backdrop: a glowing banded retro sun low on the horizon with a drift
 * of neon stars. Purely decorative and non-interactive (pointer-events disabled),
 * so a WebGL failure can't affect gameplay — the CSS gradient shows behind it.
 */

/** A canvas-drawn synthwave sun: vertical gradient disc with horizontal scan-gaps. */
function makeSunTexture(): THREE.Texture {
  const s = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  const grad = g.createLinearGradient(0, s * 0.1, 0, s * 0.92)
  grad.addColorStop(0, '#fff2a0')
  grad.addColorStop(0.42, '#ff9a3d')
  grad.addColorStop(0.72, '#ff2e97')
  grad.addColorStop(1, '#8c1070')
  g.save()
  g.beginPath()
  g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  // cut transparent horizontal bands across the lower half (the classic sun blinds)
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 12; i++) {
    const y = s * 0.55 + i * (s * 0.038)
    const h = 1.5 + i * 1.4
    g.fillRect(0, y, s, h)
  }
  g.restore()
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function SynthSun({
  position = [0, -9, -20],
  size = 17,
}: {
  position?: [number, number, number]
  size?: number
}) {
  const tex = useMemo(makeSunTexture, [])
  return (
    <group position={position}>
      {/* soft halo */}
      <mesh>
        <circleGeometry args={[size * 0.7, 64]} />
        <meshBasicMaterial color="#ff2e97" transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function SynthStars({ count = 1400 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null)
  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const magenta = new THREE.Color('#ff2e97')
    const cyan = new THREE.Color('#21e6ff')
    const violet = new THREE.Color('#9d6bff')
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 70
      positions[i * 3 + 1] = (Math.random() - 0.5) * 40 + 6 // bias upward (sky)
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40 - 10
      const r = Math.random()
      const c = r < 0.45 ? magenta : r < 0.8 ? cyan : violet
      const f = 0.4 + Math.random() * 0.6
      colors[i * 3 + 0] = c.r * f
      colors[i * 3 + 1] = c.g * f
      colors[i * 3 + 2] = c.b * f
    }
    return { positions, colors }
  }, [count])

  useFrame((state, delta) => {
    const p = ref.current
    if (!p) return
    p.rotation.y += delta * 0.012
    p.rotation.x = Math.sin(state.clock.elapsedTime * 0.04) * 0.05
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
        opacity={0.9}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export function SceneBackground() {
  const { prefs } = usePrefs()
  const kind = CHROMA_FAMILY[prefs.theme]?.backdrop ?? 'vapor'
  return (
    <div className="scene-bg" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 18], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      >
        <FamilyBackdrop kind={kind} />
      </Canvas>
    </div>
  )
}
