import { useCallback, useEffect, useState } from 'react'
import { useThreeScene } from '@/three/useThreeScene'
import { Panel, Slider, Toggle, Readout } from '@/components/controls'
import { Equation } from '@/components/Equation'
import { createLorenzScene, MAX_TRAJ, type LorenzController } from './lorenzScene'

const TEX = String.raw`
\begin{aligned}
\dot{x} &= \dfrac{-a x^{3} + (2a+b-z)\,x^{2}y + (a-2)\,x y^{2} + (z-b)\,y^{3}}{2\max(x^{2}+y^{2},\,\varepsilon)}\\[7pt]
\dot{y} &= \dfrac{(b-z)\,x^{3} + (a-2)\,x^{2}y + (-2a-b+z)\,x y^{2} - a y^{3}}{2\max(x^{2}+y^{2},\,\varepsilon)}\\[7pt]
\dot{z} &= 2x^{3}y - 2x y^{3} - c\,z \qquad (a=10,\; b=28,\; c=\tfrac{8}{3})
\end{aligned}`

/** Slider value (0..100) → number of strands drawn. */
const strandsFor = (v: number) => Math.max(1, Math.round((v / 100) * MAX_TRAJ))

export default function FourWingLorenz() {
  const [densityV, setDensityV] = useState(25) // 0..100 → strand fraction (default low)
  const [glowV, setGlowV] = useState(18) // 0..100 → bloom strength (default low/soft)
  const [spd, setSpd] = useState(15) // 0..100 → speed/100
  const [flowV, setFlowV] = useState(50) // 0..100 → flow/100
  const [particles, setParticles] = useState(true)
  const [autoRotate, setAutoRotate] = useState(true)
  const [segCount, setSegCount] = useState(0)
  const [fps, setFps] = useState(0)
  const [building, setBuilding] = useState(true)

  const { containerRef, instanceRef } = useThreeScene<LorenzController>(
    (ctx) => {
      // The scene mounts empty so the canvas paints immediately; the (expensive)
      // one-time integration is kicked off deferred below.
      const ctrl = createLorenzScene(ctx)
      ctrl.setSpeed(0.15)
      ctrl.setFlow(0.5)
      ctrl.setAutoRotate(true)
      ctrl.setParticles(true)
      ctrl.setGlow(0.18) // soft glow by default (low light pollution)
      ctrl.setDensity(0.25) // remembered now, applied when build() runs
      // any user interaction (rotate / pan / zoom) stops the auto-spin
      ctx.controls.addEventListener('start', () => {
        ctrl.setAutoRotate(false)
        setAutoRotate(false)
      })
      return ctrl
    },
    {
      clearColor: 0x000000, // pure black floor for additive glow
      fog: [0x000000, 0.006],
      fov: 55,
      cameraPosition: [0, 0, -52], // dead-on the four-pointed star from the BACK
      // side; spinning about this same (z) axis keeps it a star (never the figure-8)
      minDistance: 18,
      maxDistance: 320,
      // soft by default — the Glow slider drives strength live; threshold lifted a
      // touch so only the brightest cores bloom (less overall haze / light pollution)
      bloom: { strength: 0.22, radius: 0.45, threshold: 0.1 },
      onFps: setFps,
    },
  )

  // One-time build, deferred (two rAFs) so the "building…" overlay paints before
  // the synchronous integration freezes the thread (~2s at MAX_TRAJ). The density
  // slider afterwards is cheap (draw range only) and never re-integrates.
  const buildDeferred = useCallback(() => {
    setBuilding(true)
    // Prefer rAF (runs after the overlay paints), but fall back to a timer —
    // rAF is throttled in hidden/background tabs and would never fire there.
    let done = false
    const run = () => {
      if (done) return
      done = true
      const ctrl = instanceRef.current
      if (!ctrl) return
      setSegCount(ctrl.build())
      setBuilding(false)
    }
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(run)
    })
    const timer = window.setTimeout(run, 250)
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      clearTimeout(timer)
    }
    // instanceRef is a stable ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // first build after mount
  useEffect(() => buildDeferred(), [buildDeferred])

  const onDensity = (v: number) => {
    setDensityV(v)
    const c = instanceRef.current?.setDensity(v / 100)
    if (c != null) setSegCount(c)
  }
  const onGlow = (v: number) => {
    setGlowV(v)
    instanceRef.current?.setGlow(v / 100)
  }
  const onSpd = (v: number) => {
    setSpd(v)
    instanceRef.current?.setSpeed(v / 100)
  }
  const onFlow = (v: number) => {
    setFlowV(v)
    instanceRef.current?.setFlow(v / 100)
  }
  const onParticles = (on: boolean) => {
    setParticles(on)
    instanceRef.current?.setParticles(on)
  }
  const onAuto = (on: boolean) => {
    setAutoRotate(on)
    instanceRef.current?.setAutoRotate(on)
  }

  return (
    <>
      <div className="canvas-host" ref={containerRef} />
      {building && <div className="loading">integrating trajectories…</div>}

      <div className="topbar">
        <div className="brand">
          <b>Four-Wing Lorenz Attractor</b>
          <span>四翼洛伦兹吸引子</span>
        </div>
        <div className="tag">chaotic attractor</div>
      </div>

      <Panel title="Render">
        <Slider
          label="Density"
          value={densityV}
          min={0}
          max={100}
          step={1}
          display={`${strandsFor(densityV)} strands`}
          onChange={onDensity}
        />
        <Slider
          label="Glow"
          value={glowV}
          min={0}
          max={100}
          step={1}
          display={(glowV / 100).toFixed(2)}
          onChange={onGlow}
        />
        <Slider
          label="Rotation speed"
          value={spd}
          min={0}
          max={100}
          step={1}
          display={(spd / 100).toFixed(2)}
          onChange={onSpd}
        />
        <Slider
          label="Flow speed"
          value={flowV}
          min={0}
          max={100}
          step={1}
          display={(flowV / 100).toFixed(2)}
          onChange={onFlow}
        />
        <Toggle label="Particles" checked={particles} onChange={onParticles} />
        <Toggle label="Auto-rotate" checked={autoRotate} onChange={onAuto} />
        <Readout
          items={[
            { label: 'SEGMENTS', value: segCount.toLocaleString() },
            { label: 'FPS', value: fps > 0 ? fps : '—' },
          ]}
        />
      </Panel>

      <div className="eq">
        <h3>Differential system</h3>
        <Equation tex={TEX} />
        <div className="eq-legend">
          <span>
            <i style={{ background: '#0c5a26' }} />inner hub
          </span>
          <span>
            <i style={{ background: '#f7e85a' }} />outer wing rim
          </span>
        </div>
      </div>

      <div className="hint">
        <kbd>drag</kbd> rotate (any axis) &nbsp; <kbd>scroll</kbd> zoom
        <br />
        <kbd>right-drag</kbd> pan
      </div>
    </>
  )
}
