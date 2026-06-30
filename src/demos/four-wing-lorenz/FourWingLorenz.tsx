import { useCallback, useEffect, useState } from 'react'
import { useThreeScene } from '@/three/useThreeScene'
import { Panel, Segmented, Slider, Toggle, Readout } from '@/components/controls'
import { Equation } from '@/components/Equation'
import { createLorenzScene, type Density, type LorenzController } from './lorenzScene'

const TEX = String.raw`
\begin{aligned}
\dot{x} &= \dfrac{-a x^{3} + (2a+b-z)\,x^{2}y + (a-2)\,x y^{2} + (z-b)\,y^{3}}{2\max(x^{2}+y^{2},\,\varepsilon)}\\[7pt]
\dot{y} &= \dfrac{(b-z)\,x^{3} + (a-2)\,x^{2}y + (-2a-b+z)\,x y^{2} - a y^{3}}{2\max(x^{2}+y^{2},\,\varepsilon)}\\[7pt]
\dot{z} &= 2x^{3}y - 2x y^{3} - c\,z \qquad (a=10,\; b=28,\; c=\tfrac{8}{3})
\end{aligned}`

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Med' },
  { value: 'high', label: 'High' },
]

export default function FourWingLorenz() {
  const [density, setDensity] = useState<Density>('med')
  const [spd, setSpd] = useState(15) // 0..100 → speed/100
  const [flowV, setFlowV] = useState(50) // 0..100 → flow/100
  const [particles, setParticles] = useState(true)
  const [autoRotate, setAutoRotate] = useState(true)
  const [segCount, setSegCount] = useState(0)
  const [fps, setFps] = useState(0)
  const [building, setBuilding] = useState(true)

  const { containerRef, instanceRef } = useThreeScene<LorenzController>(
    (ctx) => {
      // No integration here — the scene mounts empty so the canvas paints
      // immediately; the (expensive) first build is kicked off deferred below.
      const ctrl = createLorenzScene(ctx)
      ctrl.setSpeed(0.15)
      ctrl.setFlow(0.5)
      ctrl.setAutoRotate(true)
      ctrl.setParticles(true)
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
      cameraPosition: [0, 2, 76], // nearly straight down +z at the pinwheel
      minDistance: 18,
      maxDistance: 320,
      onFps: setFps,
    },
  )

  // Build a density deferred (two rAFs) so the "building…" overlay paints before
  // the synchronous integration freezes the thread (~1–2.5s). Returns a canceller.
  const buildDeferred = useCallback(
    (d: Density) => {
      setBuilding(true)
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          const ctrl = instanceRef.current
          if (!ctrl) return
          setSegCount(ctrl.rebuild(d))
          setBuilding(false)
        })
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
      // instanceRef is a stable ref
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  )

  // first build after mount
  useEffect(() => buildDeferred('med'), [buildDeferred])

  const onDensity = (d: Density) => {
    setDensity(d)
    buildDeferred(d)
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
        <Segmented options={DENSITY_OPTIONS} value={density} onChange={onDensity} />
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
