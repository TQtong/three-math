import * as THREE from 'three'
import type { ThreeContext } from '@/three/harness'
import type { DemoInstance } from '@/three/useThreeScene'
import { rampColor, integrateTrajectory, makeRng, makeSeeds, type Vec3 } from './lorenzMath'

// We integrate MAX_TRAJ strands ONCE, build one LineSegments per strand, and the
// density slider toggles each strand's .visible — so dragging never re-integrates
// (instant, no freeze) AND hidden strands cost nothing to draw (low density is
// genuinely cheap, not just visually sparse).
//
// We deliberately avoid BufferGeometry.setDrawRange: on the software-GL path used
// for verification a finite draw range renders the whole buffer black. Per-strand
// .visible toggling sidesteps that and is the lighter design on real GPUs too.
export const MAX_TRAJ = 44

const WARM = 20000 // settle onto the strange attractor (~2 time units at dt=1e-4)
const RECORD = 520000 // long wander over the attractor (~52 time units)
const STRIDE = 70 // keep 1 of every 70 → ~7400 points/trajectory
const TARGET_XY = 16 // world-space xy half-extent the model is scaled to fill
const TARGET_Z = 8 // world-space z half-extent — z is normalized separately and
// kept flatter than xy so the butterfly side view is wide and the figure-8 view
// matches the reference proportions (the raw attractor is ~4.6× taller in z)
const SPEED_SCALE = 2.0 // auto-rotate rad/s per unit speed (visible full 360° spin)
const FLOW_SCALE = 90 // particle march: kept-point indices/s per unit flow
const K = 500 // particle pool; a density-scaled subset is shown (rest zero-coloured)
const MIN_PART = 24 // never show fewer comets than this (keeps low density alive)
const GLOW_MAX = 1.2 // glow slider 1.0 → this UnrealBloom strength

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
  /** 0..1 → bloom strength (the "glare"/light-pollution dial). */
  setGlow(glow: number): void
  /** 0..1 → fraction of the MAX_TRAJ strands shown (visibility toggle only);
   *  returns the visible line-segment count. Stored before build, applied after. */
  setDensity(frac: number): number
  /** One-time heavy integrate (cached) + buffer build; returns visible seg count. */
  build(): number
}

/** One integrated, centered strand plus its baked line buffers. */
interface Strand {
  pts: Float32Array // centered kept points (xyz), shared by the web + particles
  linePos: Float32Array // 2 verts/segment
  lineCol: Float32Array
  segs: number // segment count
}

/** Cached heavy result of integrating the full strand set (no THREE objects). */
interface Built {
  strands: Strand[]
  scale: number // xy scale
  scaleZ: number // z scale (separate → balanced volume)
  rMin: number // xy-radius range, for radius-based colouring
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
    opacity: 0.5, // each strand reads clearly even at low density; the (separate,
    // low-by-default) bloom is what used to over-glare, so brightness ≠ glare now
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

  let strandSegs: THREE.LineSegments[] = [] // one per strand; density toggles .visible
  let strandGeos: THREE.BufferGeometry[] = []
  let pointsGeo: THREE.BufferGeometry | null = null
  let points: THREE.Points | null = null

  /** Centered kept points per trajectory; shared by the web AND the particles. */
  let trajs: Float32Array[] = []
  let particles: Particle[] = []
  let built: Built | null = null // the one heavy integration, cached for the session

  // stable per-particle randoms so reassigning particles on a density change is
  // deterministic (no flicker) and doesn't need a live PRNG every drag
  const pRand = new Float32Array(K) // trajectory selector
  const pCursor = new Float32Array(K) // initial cursor fraction
  const pSpeed = new Float32Array(K) // march speed
  {
    const rng = makeRng(0x5eed)
    for (let k = 0; k < K; k++) {
      pRand[k] = rng()
      pCursor[k] = rng()
      pSpeed[k] = 0.4 + rng() * 1.2
    }
  }

  let autoRotate = true
  let spinSpeed = 0.15
  let flow = 0.5
  let particlesOn = true
  let curRMin = 0 // xy-radius range of the build (for particle colour)
  let curRSpan = 1
  let curDensity = 0.25 // 0..1 strand fraction; applied on/after build
  let visParticles = 0 // comets currently lit (density-scaled)

  const tmpCol = new THREE.Color()

  function disposeBuilt() {
    for (const s of strandSegs) root.remove(s)
    for (const g of strandGeos) g.dispose()
    strandSegs = []
    strandGeos = []
    if (points) {
      root.remove(points)
      points = null
    }
    pointsGeo?.dispose()
    pointsGeo = null
    trajs = []
    particles = []
    visParticles = 0
  }

  /** Write current particle positions/colours (advance cursors by `dt`). */
  function stepParticles(dt: number) {
    if (!pointsGeo || !particlesOn || trajs.length === 0 || visParticles === 0) return
    const posAttr = pointsGeo.attributes.position
    const colAttr = pointsGeo.attributes.color
    const pos = posAttr.array as Float32Array
    const col = colAttr.array as Float32Array
    for (let k = 0; k < visParticles; k++) {
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

  /** Heavy step (integration + baked buffers); cached so build() never re-integrates.
   *  THREE objects are NOT created here. */
  function integrate(): Built {
    const seeds = makeSeeds(MAX_TRAJ)

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
      return { strands: [], scale: 1, scaleZ: 1, rMin: 0, rMax: 1 }
    }
    const zHalf = Math.max(1e-3, (gmax[2] - gmin[2]) / 2)
    const center: Vec3 = [
      (gmin[0] + gmax[0]) / 2,
      (gmin[1] + gmax[1]) / 2,
      (gmin[2] + gmax[2]) / 2,
    ]

    // centered copies (origin = attractor centre, so it spins in place);
    // track the xy-radius range for both camera auto-fit and radius colouring
    let maxRxy = 1e-3
    let minRxy = Infinity
    const centered: Float32Array[] = raw.map((p) => {
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

    // per-strand LineSegments buffers: 2 verts per segment; colour by xy-radius so
    // the outer wing rims read gold and the inner hub reads green (per the reference)
    const strands: Strand[] = centered.map((pts) => {
      const segs = pts.length / 3 - 1
      const linePos = new Float32Array(segs * 2 * 3)
      const lineCol = new Float32Array(segs * 2 * 3)
      let w = 0
      const push = (idx: number) => {
        const a = idx * 3
        const r = Math.sqrt(pts[a] * pts[a] + pts[a + 1] * pts[a + 1])
        rampColor((r - minRxy) / rSpan, tmpCol)
        linePos[w * 3] = pts[a]
        linePos[w * 3 + 1] = pts[a + 1]
        linePos[w * 3 + 2] = pts[a + 2]
        lineCol[w * 3] = tmpCol.r
        lineCol[w * 3 + 1] = tmpCol.g
        lineCol[w * 3 + 2] = tmpCol.b
        w++
      }
      for (let i = 0; i < segs; i++) {
        push(i)
        push(i + 1)
      }
      return { pts, linePos, lineCol, segs }
    })

    return { strands, scale: TARGET_XY / maxRxy, scaleZ: TARGET_Z / zHalf, rMin: minRxy, rMax: maxRxy }
  }

  /** Build THREE objects from a (cached) Built — one LineSegments per strand; the
   *  density slider then toggles each strand's visibility. */
  function applyBuilt(b: Built) {
    trajs = b.strands.map((s) => s.pts)
    curRMin = b.rMin
    curRSpan = Math.max(1e-3, b.rMax - b.rMin)
    root.scale.set(b.scale, b.scale, b.scaleZ)

    strandSegs = []
    strandGeos = []
    for (const s of b.strands) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(s.linePos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(s.lineCol, 3))
      const ls = new THREE.LineSegments(g, lineMat)
      ls.frustumCulled = false
      root.add(ls)
      strandGeos.push(g)
      strandSegs.push(ls)
    }

    // particle pool at full capacity; inactive comets are zero-coloured (invisible
    // under additive blending) rather than clipped with a draw range
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
  }

  /** Cheap step: show the first `frac`·N strands and ride a matching number of
   *  comets. Pure visibility / particle-reassignment — no integration, no draw range. */
  function applyDensity(frac: number): number {
    curDensity = frac
    const maxN = strandSegs.length // non-diverged strands actually built
    if (maxN === 0) return 0
    const nVis = Math.min(maxN, Math.max(1, Math.round(frac * maxN)))
    let segs = 0
    for (let i = 0; i < maxN; i++) {
      strandSegs[i].visible = i < nVis
      if (i < nVis) segs += built?.strands[i].segs ?? 0
    }

    // scale the comet count with density so low density isn't a glare of particles
    const nPart = Math.min(K, Math.max(MIN_PART, Math.round((K * nVis) / maxN)))
    particles = []
    for (let k = 0; k < nPart; k++) {
      const traj = Math.min(nVis - 1, Math.floor(pRand[k] * nVis))
      const P = trajs[traj].length / 3
      particles.push({ traj, cursor: pCursor[k] * (P - 1), speed: pSpeed[k] })
    }
    visParticles = nPart
    if (pointsGeo) {
      // zero every comet colour, then re-light only the active subset → inactive
      // comets contribute nothing (additive black) without needing a draw range
      ;(pointsGeo.attributes.color.array as Float32Array).fill(0)
      pointsGeo.attributes.color.needsUpdate = true
      stepParticles(0)
    }
    return segs
  }

  function build(): number {
    disposeBuilt()
    if (!built) built = integrate()
    applyBuilt(built)
    return applyDensity(curDensity)
  }

  return {
    update(dt) {
      stepParticles(dt)
      // spin about the pinwheel axis (z); from the back-side (-z) view this reads CW
      if (autoRotate) root.rotation.z -= spinSpeed * SPEED_SCALE * dt
    },
    build,
    setDensity(frac) {
      curDensity = frac
      return strandSegs.length ? applyDensity(frac) : 0 // pre-build: just remember it
    },
    setGlow(glow) {
      ctx.setBloomStrength?.(Math.max(0, glow) * GLOW_MAX)
    },
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
