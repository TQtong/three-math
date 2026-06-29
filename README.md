# Three · Math

Interactive math visualizations built with **Vite + React + TypeScript + Three.js**.
A gallery designed to grow: each visualization ("案例") is a self-contained demo,
and the shared scaffolding (renderer lifecycle, controls, UI widgets, equations)
is factored out so a new demo is just a folder + one registry line.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run typecheck  # types only
```

## Architecture

```
src/
├── main.tsx                 app entry
├── App.tsx                  shell: sidebar gallery + active demo (hash-routed)
├── useHashRoute.ts          tiny dependency-free #/slug router
├── index.css                theme tokens + shared overlay/control styles
│
├── three/                   ── reusable Three.js core (demo-agnostic) ──
│   ├── harness.ts           createHarness(): renderer + scene + camera +
│   │                        OrbitControls + RAF loop + resize + fps + disposal
│   └── useThreeScene.ts     React hook binding a demo factory to the harness
│
├── components/              ── reusable UI ──
│   ├── controls.tsx         Panel · Segmented · Slider · Toggle · Readout
│   └── Equation.tsx         KaTeX renderer (npm, no CDN)
│
└── demos/
    ├── registry.ts          the list of all demos (add cases here)
    └── klein-bottle/        ── one case ──
        ├── KleinBottle.tsx  default-export React component (UI + wiring)
        ├── kleinScene.ts    builds Three.js objects, exposes an imperative controller
        └── kleinGeometry.ts pure math: parametric surface, welding, colour ramp
```

The split that makes cases cheap to add:

- **`three/harness.ts`** owns everything tied to "running a Three.js scene in a
  resizable DOM box" — a demo never touches the renderer, `window`, or the loop.
- **Pure math** (`*Geometry.ts`) has no Three.js scene state, so it's testable
  and reusable (the Klein seam ring and the surface share the same `kleinPoint`).
- **Scene controllers** (`*Scene.ts`) build objects and expose plain methods
  (`setMode`, `rebuild`, …); React drives them through a ref, so 60fps rendering
  never causes React re-renders.

## Adding a new case

1. `src/demos/<your-demo>/` with a default-export React component.
2. (Recommended) keep pure math in `*Geometry.ts` and Three.js setup in `*Scene.ts`.
3. Use `useThreeScene(setup, options)` to mount it; build your panel from
   `components/controls`.
4. Append one entry to `demos` in `src/demos/registry.ts` — done. It's lazy-loaded
   and code-split automatically.

## Notes on the Klein bottle port

Ported from a standalone HTML file. Changes made during the port:

- Three.js and KaTeX are now npm dependencies (no CDN / import-map).
- The hand-rolled orbit camera was replaced with Three.js `OrbitControls`
  (damping, correct pan/zoom, auto-rotate that yields to user input).
- Zoom is clamped (`minDistance`/`maxDistance`, like the original's radius clamp)
  so scrolling can't fly the camera *inside* the surface — where `DoubleSide`
  renders the inner walls and the bottle appears flat / see-through.
- Sizing is container-based (`ResizeObserver`), so the scene fits the gallery
  layout instead of assuming the full window.
- Full GPU teardown on unmount (geometries, materials, renderer) so switching
  cases doesn't leak WebGL contexts.
- The `seamBlend` global became an explicit parameter threaded through the pure
  geometry functions.
- Fixed the dark crease/step at the u=0/2π seam. The original glued the wrap with
  a `v→π−v` reflection and **welded** the coincident rings; because the surface is
  non-orientable, the two sheets there have antiparallel normals, so welding made
  `computeVertexNormals` average them to ~zero → a black creased step. The
  geometry is now a plain parametric grid whose u=0 and u=2π rings are left
  **unwelded** (they coincide exactly, gap = 0): each sheet keeps its own
  full-length normal, so `DoubleSide` shades both cleanly. A periodic colour ramp
  (same colour at u=0 and u=2π) removes the colour seam. The branch weight is only
  crossfaded at u=π — *not* at the wrap, where the branches are v-reflected and
  blending them would cancel and pinch the neck to a point.
