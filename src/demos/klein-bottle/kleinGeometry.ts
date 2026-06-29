import * as THREE from 'three'

/**
 * Klein bottle — the classic "bottle" immersion, built as an indexed,
 * smoothly-shaded BufferGeometry by sampling the parametric surface on a
 * straightforward u×v grid.
 *
 * Pure module: no Three.js scene state, no globals. `seamBlend` is passed in so
 * the same functions serve both the surface and the seam-highlight ring.
 *
 *   u ∈ [0, 2π], v ∈ [0, 2π]
 *
 * The formula switches between a "handle" branch (uses cos v) and a "bulb" branch
 * (uses cos(v+π), the v-reflection) with a hard sign(u−π). At u=π the two branches
 * coincide with the SAME v, so we crossfade them over a band of half-width
 * `seamBlend` for a smooth (C1) transition.
 *
 * At the periodic wrap u=0≡2π the branches coincide v-REFLECTED, so they cannot
 * be blended (that cancels and pinches the neck). Instead the surface is built as
 * a plain grid whose u=0 and u=2π rings are left as separate, coincident vertices
 * (not welded): the mesh looks closed, but computeVertexNormals never averages
 * the two opposite-orientation sheets — which is what caused the dark crease.
 */

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const TAU = Math.PI * 2

/**
 * Bulb weight: 0 on the handle side (u<π), 1 on the bulb side (u>π), crossfaded
 * over a band of half-width `seamBlend` at u=π.
 *
 * We deliberately do NOT crossfade at the wrap (u=0/2π). There the handle and
 * bulb branches describe the same circle but v-REFLECTED (+r·cosv vs −r·cosv), so
 * linearly blending them cancels and pinches the neck to a point. The wrap seam
 * is instead handled geometrically (the two coincident rings are left unwelded).
 */
function bulbWeight(u: number, seamBlend: number): number {
  if (seamBlend <= 1e-4) return u > Math.PI ? 1 : 0 // exact formula
  return smoothstep(Math.PI - seamBlend, Math.PI + seamBlend, u)
}

/** Evaluate the surface point at (u, v) into `target`. */
export function kleinPoint(
  u: number,
  v: number,
  seamBlend: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const cu = Math.cos(u)
  const su = Math.sin(u)
  const cv = Math.cos(v)
  const sv = Math.sin(v)
  const r = 4 * (1 - cu / 2)

  const bulb = bulbWeight(u, seamBlend)
  const handle = 1 - bulb

  const x = 6 * cu * (1 + su) + handle * r * cu * cv + bulb * r * Math.cos(v + Math.PI)
  const y = r * sv
  const z = 16 * su + handle * r * su * cv
  return target.set(x, y, z)
}

/* ---------- u-parameter → gradient colour (periodic: teal→green→amber→rose→teal) ----------
 * The ramp returns to its start colour at t=1 so the wrap seam (u=0 ≡ 2π — the
 * same physical neck) is a single continuous colour, not a teal↔steel jump. */
const stops: [number, THREE.Color][] = [
  [0.0, new THREE.Color(0x3fbfa0)], // teal   — handle / neck (u=0)
  [0.28, new THREE.Color(0x8fd17a)], // green
  [0.5, new THREE.Color(0xe8b85a)], // amber  — bulb (u=π)
  [0.72, new THREE.Color(0xe89a8a)], // rose
  [1.0, new THREE.Color(0x3fbfa0)], // teal   — back to the neck (u=2π)
]

function uColor(t: number, out: THREE.Color): THREE.Color {
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
      return out.copy(stops[i][1]).lerp(stops[i + 1][1], f)
    }
  }
  return out.copy(stops[stops.length - 1][1])
}

export interface KleinGeometry {
  geometry: THREE.BufferGeometry
  /** Surface center BEFORE geometry.center() shifted it — used to align the seam ring. */
  rawCenter: THREE.Vector3
}

/**
 * Build the surface as a plain parametric grid. Rings run u = 0 … 2π inclusive;
 * columns are periodic in v (column segV wraps to 0 via the index). We do NOT
 * weld or glue the u=0 and u=2π rings together: they coincide in space, so the
 * surface looks closed, but keeping them as separate vertices means
 * computeVertexNormals never averages the two opposite-orientation sheets at the
 * non-orientable seam — which is what produced the dark cancellation crease.
 */
export function buildGeometry(seg: number, seamBlend: number): KleinGeometry {
  const segU = seg
  const segV = Math.round(seg * 0.75)
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const p = new THREE.Vector3()
  const c = new THREE.Color()

  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * TAU
    uColor(i / segU, c)
    for (let j = 0; j < segV; j++) {
      const v = (j / segV) * TAU
      kleinPoint(u, v, seamBlend, p)
      pos.push(p.x, p.y, p.z)
      col.push(c.r, c.g, c.b)
    }
  }
  const stride = segV

  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const j1 = (j + 1) % segV // v wraps
      const a = i * stride + j
      const b = (i + 1) * stride + j
      const cc = i * stride + j1
      const d = (i + 1) * stride + j1
      idx.push(a, b, cc, b, d, cc)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals() // smooth across the v-loop and the u interior
  g.computeBoundingBox()
  const rawCenter = new THREE.Vector3()
  g.boundingBox!.getCenter(rawCenter) // center BEFORE shifting, for seam-ring alignment
  g.center()
  return { geometry: g, rawCenter }
}
