import * as THREE from 'three'

/**
 * Four-wing Lorenz attractor — a conformal complex-square transform of the
 * classic Lorenz system that folds the two wings into four.
 *
 * Pure module: no Three.js scene state, no globals beyond constants (and
 * THREE.Color for the ramp). The ODE:
 *
 *   ẋ = [ -a x³ + (2a+b-z) x²y + (a-2) xy² + (z-b) y³ ] / [ 2(x²+y²) ]
 *   ẏ = [ (b-z) x³ + (a-2) x²y + (-2a-b+z) xy² - a y³ ] / [ 2(x²+y²) ]
 *   ż = 2x³y - 2xy³ - c z
 *
 * with a=10, b=28, c=6. The 1/(2(x²+y²)) term is singular at the origin, so the
 * denominator is floored (EPS2); near the origin the cubic numerator → 0 faster
 * than the denominator, so the floored field stays bounded.
 */

const A = 10
const B = 28
// c is the Lorenz β. The attractor is a *strange attractor* (unstable wing foci,
// dark eyes, 3D folding) only for c ≲ 3; at c=6 the foci are stable and it
// collapses to fixed points. The canonical chaotic value is β = 8/3.
const C = 8 / 3
const EPS2 = 1e-6 // floor on x²+y² so the field never blows up at the origin

// Small step is essential: with larger dt RK4 numerically over-damps the
// (genuinely unstable) wing foci and the whole thing collapses to fixed points.
// At this dt the wings open into wide orbits that reach near the centre hub.
export const DT = 0.0001

export type Vec3 = [number, number, number]

/** Writes the derivative of (x,y,z) into `out`. */
function deriv(x: number, y: number, z: number, out: Vec3): void {
  const x2 = x * x
  const y2 = y * y
  const den = 2 * Math.max(x2 + y2, EPS2)
  out[0] = (-A * x * x2 + (2 * A + B - z) * x2 * y + (A - 2) * x * y2 + (z - B) * y * y2) / den
  out[1] = ((B - z) * x * x2 + (A - 2) * x2 * y + (-2 * A - B + z) * x * y2 - A * y * y2) / den
  out[2] = 2 * x2 * x * y - 2 * x * y2 * y - C * z
}

// reused scratch so the hot loop allocates nothing
const k1: Vec3 = [0, 0, 0]
const k2: Vec3 = [0, 0, 0]
const k3: Vec3 = [0, 0, 0]
const k4: Vec3 = [0, 0, 0]

/** One classic RK4 step; advances `s` into `out`. */
export function rk4Step(s: Vec3, out: Vec3): void {
  const x = s[0]
  const y = s[1]
  const z = s[2]
  deriv(x, y, z, k1)
  deriv(x + 0.5 * DT * k1[0], y + 0.5 * DT * k1[1], z + 0.5 * DT * k1[2], k2)
  deriv(x + 0.5 * DT * k2[0], y + 0.5 * DT * k2[1], z + 0.5 * DT * k2[2], k3)
  deriv(x + DT * k3[0], y + DT * k3[1], z + DT * k3[2], k4)
  out[0] = x + (DT / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
  out[1] = y + (DT / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
  out[2] = z + (DT / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
}

/** Deterministic PRNG so the attractor is identical on every mount. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seeded PRNG (for deterministic particle assignment). */
export function makeRng(seed: number): () => number {
  return mulberry32(seed)
}

/**
 * `n` reproducible seeds spread over the attractor's neighbourhood. The system
 * is chaotic, so after a short transient every trajectory wanders the entire
 * strange attractor (all four wings); the seeds mainly decorrelate the strands.
 */
export function makeSeeds(n: number): Vec3[] {
  const rng = mulberry32(0xc0ffee)
  const seeds: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const theta = rng() * Math.PI * 2
    const r = 1 + rng() * 4 // 1 .. 5
    seeds.push([Math.cos(theta) * r, Math.sin(theta) * r, 8 + rng() * 36]) // z 8..44
  }
  return seeds
}

export interface Trajectory {
  /** Flat xyz of the kept (decimated) points. */
  positions: Float32Array
  min: Vec3
  max: Vec3
  /** True if the trajectory escaped the attractor (should be discarded). */
  diverged: boolean
}

/**
 * Integrate one trajectory: discard `warm` transient steps, then record one
 * point every `stride` steps for `record` steps. Returns the kept points and
 * their bounding box.
 */
export function integrateTrajectory(
  seed: Vec3,
  warm: number,
  record: number,
  stride: number,
): Trajectory {
  const s: Vec3 = [seed[0], seed[1], seed[2]]
  const out: Vec3 = [0, 0, 0]
  const kept = Math.ceil(record / stride)
  const positions = new Float32Array(kept * 3)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let w = 0
  let diverged = false
  for (let step = 0; step < warm + record; step++) {
    rk4Step(s, out)
    s[0] = out[0]
    s[1] = out[1]
    s[2] = out[2]
    // The attractor lives within r_xy≲7, z∈[~6,46]. Anything well outside has
    // escaped (a few seeds can, at some dt) — bail BEFORE recording the outlier
    // so it can't pollute the bounding box, and flag it for discard.
    const rxy = Math.sqrt(s[0] * s[0] + s[1] * s[1])
    if (!Number.isFinite(rxy) || !Number.isFinite(s[2]) || rxy > 25 || s[2] > 110 || s[2] < -30) {
      diverged = true
      break
    }
    if (step >= warm && (step - warm) % stride === 0) {
      positions[w++] = s[0]
      positions[w++] = s[1]
      positions[w++] = s[2]
      for (let d = 0; d < 3; d++) {
        if (s[d] < min[d]) min[d] = s[d]
        if (s[d] > max[d]) max[d] = s[d]
      }
    }
  }
  return { positions: positions.subarray(0, w), min, max, diverged }
}

/* ---------- arc-length colour ramp: deep green tail → bright yellow head ---------- */
/* radius ramp: dark green near the centre/hub → gold at the outer wing rims */
const RAMP: [number, THREE.Color][] = [
  [0.0, new THREE.Color(0x0c5a26)], // deep green (inner / hub)
  [0.45, new THREE.Color(0x3fc23f)], // green
  [0.72, new THREE.Color(0x9fe23f)], // yellow-green
  [0.9, new THREE.Color(0xe8d24a)], // gold
  [1.0, new THREE.Color(0xf7e85a)], // bright gold (outer rim)
]

/** Sample the ramp at t∈[0,1] into `out`. */
export function rampColor(t: number, out: THREE.Color): THREE.Color {
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (t <= RAMP[i + 1][0]) {
      const f = (t - RAMP[i][0]) / (RAMP[i + 1][0] - RAMP[i][0])
      return out.copy(RAMP[i][1]).lerp(RAMP[i + 1][1], f)
    }
  }
  return out.copy(RAMP[RAMP.length - 1][1])
}
