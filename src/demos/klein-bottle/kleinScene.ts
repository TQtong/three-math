import * as THREE from 'three'
import type { ThreeContext } from '@/three/harness'
import type { DemoInstance } from '@/three/useThreeScene'
import { buildGeometry, kleinPoint } from './kleinGeometry'

export type RenderMode = 'solid' | 'wire' | 'points'

/** Imperative handle the React UI drives. All scene mutation lives here. */
export interface KleinController extends DemoInstance {
  /** Rebuild the surface; returns the welded vertex count. */
  rebuild(seg: number, blend: number): number
  setMode(mode: RenderMode): void
  setSeam(on: boolean): void
  setAutoRotate(on: boolean): void
  /** speed in 0..1 (matches the UI slider / 100). */
  setSpeed(speed: number): void
}

// rad/sec per unit of the 0..1 UI speed (auto-rotate spins the model itself,
// since TrackballControls has no built-in autoRotate)
const SPEED_SCALE = 1.6

export function createKleinScene(ctx: ThreeContext): KleinController {
  const { scene } = ctx

  const root = new THREE.Group()
  scene.add(root)

  // lights for the solid mesh
  const ambient = new THREE.AmbientLight(0xffffff, 0.55)
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.05)
  keyLight.position.set(20, 30, 25)
  const rimLight = new THREE.DirectionalLight(0x6fd6ff, 0.5)
  rimLight.position.set(-25, -10, -20)
  scene.add(ambient, keyLight, rimLight)

  const matSolid = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
    flatShading: false,
  })
  const matWire = new THREE.MeshBasicMaterial({
    vertexColors: true,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  })
  const matPoints = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  })
  const seamMat = new THREE.LineBasicMaterial({ color: 0x5fd9d0 })

  let geometry: THREE.BufferGeometry | null = null
  let rawCenter = new THREE.Vector3()
  let surface: THREE.Object3D | null = null
  let seamLine: THREE.Line | null = null

  let mode: RenderMode = 'solid'
  let blend = 0.42
  let seamOn = true
  let autoRotate = true
  let spinSpeed = 0.2 // 0..1

  function makeSurface() {
    if (surface) root.remove(surface)
    if (!geometry) return
    surface =
      mode === 'points'
        ? new THREE.Points(geometry, matPoints)
        : new THREE.Mesh(geometry, mode === 'wire' ? matWire : matSolid)
    root.add(surface)
  }

  /** Seam highlight at u = π (the self-intersection ring). */
  function updateSeam() {
    if (seamLine) {
      root.remove(seamLine)
      seamLine.geometry.dispose()
      seamLine = null
    }
    if (!seamOn) return
    const pts: THREE.Vector3[] = []
    const p = new THREE.Vector3()
    const N = 160
    const u = Math.PI
    for (let j = 0; j <= N; j++) {
      kleinPoint(u, (j / N) * Math.PI * 2, blend, p)
      pts.push(p.clone())
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    // buildGeometry's center() shifted the surface by rawCenter; match it so the ring aligns
    g.translate(-rawCenter.x, -rawCenter.y, -rawCenter.z)
    seamLine = new THREE.Line(g, seamMat)
    root.add(seamLine)
  }

  function rebuild(seg: number, newBlend: number): number {
    blend = newBlend
    geometry?.dispose()
    const built = buildGeometry(seg, blend)
    geometry = built.geometry
    rawCenter = built.rawCenter
    makeSurface()
    updateSeam()
    return geometry.attributes.position.count
  }

  return {
    // spin the model itself when auto-rotate is on (control-agnostic)
    update(dt) {
      if (autoRotate) root.rotation.y += spinSpeed * SPEED_SCALE * dt
    },
    rebuild,
    setMode(m) {
      mode = m
      makeSurface()
    },
    setSeam(on) {
      seamOn = on
      updateSeam()
    },
    setAutoRotate(on) {
      autoRotate = on
    },
    setSpeed(speed) {
      spinSpeed = speed
    },
    dispose() {
      if (seamLine) {
        root.remove(seamLine)
        seamLine.geometry.dispose()
      }
      if (surface) root.remove(surface)
      geometry?.dispose()
      matSolid.dispose()
      matWire.dispose()
      matPoints.dispose()
      seamMat.dispose()
      scene.remove(root, ambient, keyLight, rimLight)
    },
  }
}
