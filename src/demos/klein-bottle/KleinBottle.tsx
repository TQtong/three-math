import { useState } from 'react'
import { useThreeScene } from '@/three/useThreeScene'
import { Panel, Segmented, Slider, Toggle, Readout } from '@/components/controls'
import { Equation } from '@/components/Equation'
import { createKleinScene, type KleinController, type RenderMode } from './kleinScene'

const TEX = String.raw`
\text{KleinBottle}=\begin{cases}
x = 6\cos u\,(1+\sin u) + \max(-\operatorname{sign}(u-\pi),0)\,4\!\left(1-\tfrac{\cos u}{2}\right)\cos u\cos v + \max(\operatorname{sign}(u-\pi),0)\,4\!\left(1-\tfrac{\cos u}{2}\right)\cos(v+\pi)\\[6pt]
y = 4\!\left(1-\tfrac{\cos u}{2}\right)\sin v\\[6pt]
z = 16\sin u + \max(-\operatorname{sign}(u-\pi),0)\,4\!\left(1-\tfrac{\cos u}{2}\right)\sin u\cos v
\end{cases}`

const MODE_OPTIONS: { value: RenderMode; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'wire', label: 'Wireframe' },
  { value: 'points', label: 'Points' },
]

export default function KleinBottle() {
  const [mode, setMode] = useState<RenderMode>('solid')
  const [res, setRes] = useState(120)
  const [spd, setSpd] = useState(20) // 0..100 → speed/100
  const [blend, setBlend] = useState(42) // 0..80 → blend/100
  const [autoRotate, setAutoRotate] = useState(true)
  const [seamOn, setSeamOn] = useState(true)
  const [vCount, setVCount] = useState(0)
  const [fps, setFps] = useState(0)

  const { containerRef, instanceRef } = useThreeScene<KleinController>(
    (ctx) => {
      const ctrl = createKleinScene(ctx)
      setVCount(ctrl.rebuild(120, 0.42))
      ctrl.setSpeed(0.2)
      ctrl.setAutoRotate(true)
      // any user interaction (orbit / pan / zoom) stops the auto-spin
      ctx.controls.addEventListener('start', () => {
        ctx.controls.autoRotate = false
        setAutoRotate(false)
      })
      return ctrl
    },
    {
      clearColor: 0x08090c,
      fog: [0x08090c, 0.0065],
      cameraPosition: [28, 18, 46],
      // the bottle's bounding sphere is ~22 units; keep the camera outside it so
      // scrolling can't fly inside the surface (where DoubleSide shows the inner walls)
      minDistance: 24,
      maxDistance: 120,
      onFps: setFps,
    },
  )

  const onMode = (m: RenderMode) => {
    setMode(m)
    instanceRef.current?.setMode(m)
  }
  const onRes = (v: number) => {
    setRes(v)
    const vc = instanceRef.current?.rebuild(v, blend / 100)
    if (vc != null) setVCount(vc)
  }
  const onSpd = (v: number) => {
    setSpd(v)
    instanceRef.current?.setSpeed(v / 100)
  }
  const onBlend = (v: number) => {
    setBlend(v)
    const vc = instanceRef.current?.rebuild(res, v / 100)
    if (vc != null) setVCount(vc)
  }
  const onAuto = (on: boolean) => {
    setAutoRotate(on)
    instanceRef.current?.setAutoRotate(on)
  }
  const onSeam = (on: boolean) => {
    setSeamOn(on)
    instanceRef.current?.setSeam(on)
  }

  return (
    <>
      <div className="canvas-host" ref={containerRef} />

      <div className="topbar">
        <div className="brand">
          <b>Klein Bottle</b>
          <span>克莱因瓶 · 数理与编程</span>
        </div>
        <div className="tag">non-orientable surface</div>
      </div>

      <Panel title="Render">
        <Segmented options={MODE_OPTIONS} value={mode} onChange={onMode} />
        <Slider label="Mesh resolution" value={res} min={40} max={220} step={10} onChange={onRes} />
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
          label="Seam smoothing"
          value={blend}
          min={0}
          max={80}
          step={2}
          display={(blend / 100).toFixed(2)}
          onChange={onBlend}
        />
        <Toggle label="Auto-rotate" checked={autoRotate} onChange={onAuto} />
        <Toggle label="Highlight seam (u=π)" checked={seamOn} onChange={onSeam} />
        <Readout
          items={[
            { label: 'VERTICES', value: vCount.toLocaleString() },
            { label: 'FPS', value: fps > 0 ? fps : '—' },
          ]}
        />
      </Panel>

      <div className="eq">
        <h3>Parametric definition</h3>
        <Equation tex={TEX} />
        <div className="eq-legend">
          <span>
            <i style={{ background: 'var(--teal)' }} />u &lt; π · handle
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />u ≥ π · bulb
          </span>
        </div>
      </div>

      <div className="hint">
        <kbd>drag</kbd> orbit &nbsp; <kbd>scroll</kbd> zoom
        <br />
        <kbd>right-drag</kbd> pan
      </div>
    </>
  )
}
