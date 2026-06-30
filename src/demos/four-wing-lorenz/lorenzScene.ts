import * as THREE from 'three'
import type { ThreeContext } from '@/three/harness'
import type { DemoInstance } from '@/three/useThreeScene'
import { rampColor, integrateTrajectory, makeRng, makeSeeds, type Vec3 } from './lorenzMath'

export type Density = 'low' | 'med' | 'high'

const DENSITY: Record<Density, number> = { low: 12, med: 24, high: 44 }

const WARM = 20000 // settle onto the strange attractor (~2 time units at dt=1e-4)
const RECORD = 520000 // long wander over the attractor (~52 time units)
const STRIDE = 70 // keep 1 of every 70 → ~7400 points/trajectory
const TARGET_XY = 16 // world-space xy half-extent the model is scaled to fill
const SPEED_SCALE = 0.5 // auto-rotate rad/s per unit speed
const FLOW_SCALE = 90 // particle march: kept-point indices/s per unit flow
const K = 500 // glow particles

interface Particle {
  traj: number
  cursor: number // float index into the trajectory's kept points
  speed: number // per-particle multiplier
}

export interface LorenzController extends DemoInstance {
  setAutoRotate(on: boolean): void
  setSpeed(speed: number): void // 0..1 (auto-rotate)
  setFlow(flow: number): void // 0..1 (particle march)
  setParticles(on: boolean): void
  /** (Re)build at a density preset; returns the line-segment count. Integration
   *  is cached per density, so re-selecting one is instant. */
  rebuild(density: Density): number
}

/** Cached heavy result of integrating one density (no THREE objects). */
interface Built {
  trajs: Float32Array[]
  linePos: Float32Array
  lineCol: Float32Array
  scale: number
  segCount: number
  rMin: number // xy-radius range, for radius-based colouring of particles
  rMax: number
}

/** A soft round glow sprite, built once on a canvas. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.5)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

export function createLorenzScene(ctx: ThreeContext): LorenzController {
  const { scene } = ctx

  const root = new THREE.Group()
  scene.add(root)

  const glowTex = makeGlowTexture()

  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.3, // density builds brightness, not per-stroke alpha
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  })
  const pointsMat = new THREE.PointsMaterial({
    map: glowTex,
    size: 0.5,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })

  let lineGeo: THREE.BufferGeometry | null = null
  let lineSeg: THREE.LineSegments | null = null
  let pointsGeo: THREE.BufferGeometry | null = null
  let points: THREE.Points | null = null

  /** Centered kept points per trajectory; shared by the web AND the particles. */
  let trajs: Float32Array[] = []
  let particles: Particle[] = []
  const cache = new Map<Density, Built>() // integration result per density

  let autoRotate = true
  let spinSpeed = 0.15
  let flow = 0.5
  let particlesOn = true
  let curRMin = 0 // xy-radius range of the current build (for particle colour)
  let curRSpan = 1

  const tmpCol = new THREE.Color()

  function disposeBuilt() {
    if (lineSeg) {
      root.remove(lineSeg)
      lineSeg = null
    }
    lineGeo?.dispose()
    lineGeo = null
    if (points) {
      root.remove(points)
      points = null
    }
    pointsGeo?.dispose()
    pointsGeo = null
    trajs = []
    particles = []
  }

  /** Write current particle positions/colours (advance cursors by `dt`). */
  function stepParticles(dt: number) {
    if (!pointsGeo || !particlesOn || trajs.length === 0) return
    const posAttr = pointsGeo.attributes.position
    const colAttr = pointsGeo.attributes.color
    const pos = posAttr.array as Float32Array
    const col = colAttr.array as Float32Array
    for (let k = 0; k < particles.length; k++) {
      const pa = particles[k]
      const t = trajs[pa.traj]
      const P = t.length / 3
      const span = P - 1
      pa.cursor += pa.speed * flow * FLOW_SCALE * dt
      while (pa.cursor >= span) pa.cursor -= span
      const i = Math.floor(pa.cursor)
      const f = pa.cursor - i
      const a = i * 3
      const b = (i + 1) * 3
      const x = t[a] + (t[b] - t[a]) * f
      const y = t[a + 1] + (t[b + 1] - t[a + 1]) * f
      pos[k * 3] = x
      pos[k * 3 + 1] = y
      pos[k * 3 + 2] = t[a + 2] + (t[b + 2] - t[a + 2]) * f
      rampColor((Math.sqrt(x * x + y * y) - curRMin) / curRSpan, tmpCol)
      col[k * 3] = Math.min(1, tmpCol.r * 1.6)
      col[k * 3 + 1] = Math.min(1, tmpCol.g * 1.6)
      col[k * 3 + 2] = Math.min(1, tmpCol.b * 1.6)
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }

  /** Heavy step (integration + baked buffers); cached per density so re-selecting
   *  a density never re-integrates. THREE objects are NOT created here. */
  function integrate(density: Density): Built {
    const n = DENSITY[density]
    const seeds = makeSeeds(n)

    // integrate; accumulate the global bounding box for centering
    const raw: Float32Array[] = []
    const gmin: Vec3 = [Infinity, Infinity, Infinity]
    const gmax: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const seed of seeds) {
      const tr = integrateTrajectory(seed, WARM, RECORD, STRIDE)
      if (tr.diverged || tr.positions.length < 6) continue // skip escapees / too-short
      raw.push(tr.positions)
      for (let d = 0; d < 3; d++) {
        if (tr.min[d] < gmin[d]) gmin[d] = tr.min[d]
        if (tr.max[d] > gmax[d]) gmax[d] = tr.max[d]
      }
    }
    if (raw.length === 0) {
      return { trajs: [], linePos: new Float32Array(0), lineCol: new Float32Array(0), scale: 1, segCount: 0, rMin: 0, rMax: 1 }
    }
    const center: Vec3 = [
      (gmin[0] + gmax[0]) / 2,
      (gmin[1] + gmax[1]) / 2,
      (gmin[2] + gmax[2]) / 2,
    ]

    // centered copies (origin = attractor centre, so it spins in place);
    // track the xy-radius range for both camera auto-fit and radius colouring
    let maxRxy = 1e-3
    let minRxy = Infinity
    const built: Float32Array[] = raw.map((p) => {
      const c = new Float32Array(p.length)
      for (let i = 0; i < p.length; i += 3) {
        const cx = p[i] - center[0]
        const cy = p[i + 1] - center[1]
        c[i] = cx
        c[i + 1] = cy
        c[i + 2] = p[i + 2] - center[2]
        const rxy = Math.sqrt(cx * cx + cy * cy)
        if (rxy > maxRxy) maxRxy = rxy
        if (rxy < minRxy) minRxy = rxy
      }
      return c
    })
    const rSpan = Math.max(1e-3, maxRxy - minRxy)

    // merged LineSegments: 2 verts per segment; colour by xy-radius so the outer
    // wing rims read gold and the inner hub reads green (matching the reference)
    let totalVerts = 0
    for (const t of built) totalVerts += 2 * (t.length / 3 - 1)
    const linePos = new Float32Array(totalVerts * 3)
    const lineCol = new Float32Array(totalVerts * 3)
    let w = 0
    const push = (t: Float32Array, idx: number) => {
      const a = idx * 3
      const r = Math.sqrt(t[a] * t[a] + t[a + 1] * t[a + 1])
      rampColor((r - minRxy) / rSpan, tmpCol)
      linePos[w * 3] = t[a]
      linePos[w * 3 + 1] = t[a + 1]
      linePos[w * 3 + 2] = t[a + 2]
      lineCol[w * 3] = tmpCol.r
      lineCol[w * 3 + 1] = tmpCol.g
      lineCol[w * 3 + 2] = tmpCol.b
      w++
    }
    for (const t of built) {
      const span = t.length / 3 - 1
      for (let i = 0; i < span; i++) {
        push(t, i)
        push(t, i + 1)
      }
    }
    return { trajs: built, linePos, lineCol, scale: TARGET_XY / maxRxy, segCount: totalVerts / 2, rMin: minRxy, rMax: maxRxy }
  }

  /** Cheap step: build THREE objects from a (cached) Built. */
  function applyBuilt(b: Built) {
    trajs = b.trajs
    curRMin = b.rMin
    curRSpan = Math.max(1e-3, b.rMax - b.rMin)
    root.scale.setScalar(b.scale)

    lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(b.linePos, 3).setUsage(THREE.StaticDrawUsage),
    )
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(b.lineCol, 3))
    lineSeg = new THREE.LineSegments(lineGeo, lineMat)
    lineSeg.frustumCulled = false
    root.add(lineSeg)

    // particles riding the same kept points (skip entirely if no trajectories)
    const rng = makeRng(0x5eed)
    particles = []
    for (let k = 0; k < K && trajs.length > 0; k++) {
      const traj = Math.floor(rng() * trajs.length)
      const P = trajs[traj].length / 3
      particles.push({ traj, cursor: rng() * (P - 1), speed: 0.4 + rng() * 1.2 })
    }
    pointsGeo = new THREE.BufferGeometry()
    pointsGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(K * 3), 3).setUsage(THREE.DynamicDrawUsage),
    )
    pointsGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Float32Array(K * 3), 3).setUsage(THREE.DynamicDrawUsage),
    )
    points = new THREE.Points(pointsGeo, pointsMat)
    points.visible = particlesOn
    points.frustumCulled = false
    root.add(points)
    stepParticles(0) // fill initial positions/colours
  }

  function rebuild(density: Density): number {
    disposeBuilt()
    let b = cache.get(density)
    if (!b) {
      b = integrate(density)
      cache.set(density, b)
    }
    applyBuilt(b)
    return b.segCount
  }

  return {
    update(dt) {
      stepParticles(dt)
      if (autoRotate) root.rotation.z += spinSpeed * SPEED_SCALE * dt
    },
    rebuild,
    setAutoRotate(on) {
      autoRotate = on
    },
    setSpeed(speed) {
      spinSpeed = speed
    },
    setFlow(f) {
      flow = f
    },
    setParticles(on) {
      particlesOn = on
      if (points) points.visible = on
    },
    dispose() {
      disposeBuilt()
      scene.remove(root)
      lineMat.dispose()
      pointsMat.dispose()
      glowTex.dispose()
    },
  }
}
