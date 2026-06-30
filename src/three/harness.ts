import * as THREE from 'three'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

/**
 * The runtime context handed to every demo. A demo only ever talks to Three.js
 * through this object — it never creates a renderer, reads the window size, or
 * owns the animation loop. That keeps demos small and makes the harness the one
 * place responsible for lifecycle, resizing, and disposal.
 */
export interface ThreeContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  /** TrackballControls — free rotation in any direction (no locked up-axis). */
  controls: TrackballControls
  /** The DOM element the canvas lives in. Sizing is derived from this, not `window`. */
  container: HTMLElement
}

export interface HarnessOptions {
  clearColor?: number
  /** Exponential fog: [color, density]. Omit for no fog. */
  fog?: [color: number, density: number]
  fov?: number
  near?: number
  far?: number
  cameraPosition?: [number, number, number]
  /** Controls target. Defaults to the origin. */
  target?: [number, number, number]
  /** Momentum after release (TrackballControls dynamic damping). Default true. */
  enableDamping?: boolean
  /** Clamp how close/far the camera can get — keeps it from flying inside the surface. */
  minDistance?: number
  maxDistance?: number
  /** Called ~twice a second with the rounded frame rate. */
  onFps?: (fps: number) => void
  /** Add a bloom glow pass — for additive/glowing scenes (e.g. attractors). */
  bloom?: { strength?: number; radius?: number; threshold?: number }
}

export interface Harness {
  ctx: ThreeContext
  /** Register the per-frame callback. dt and elapsed are in seconds. */
  setUpdate(fn: ((dt: number, elapsed: number) => void) | null): void
  /** Tear everything down: stop the loop, drop listeners, free GPU resources. */
  dispose(): void
}

/**
 * Boots a Three.js renderer inside `container` and runs a requestAnimationFrame
 * loop. Returns a {@link Harness} whose `ctx` is passed to a demo factory.
 *
 * Sizing tracks the container via ResizeObserver, so the same harness works
 * fullscreen or inside a panelled gallery layout.
 */
export function createHarness(container: HTMLElement, opts: HarnessOptions = {}): Harness {
  const {
    clearColor = 0x08090c,
    fov = 42,
    near = 0.1,
    far = 1000,
    cameraPosition = [28, 18, 46],
    target = [0, 0, 0],
    enableDamping = true,
  } = opts

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(clearColor, 1)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  if (opts.fog) scene.fog = new THREE.FogExp2(opts.fog[0], opts.fog[1])

  const camera = new THREE.PerspectiveCamera(fov, 1, near, far)
  camera.position.set(...cameraPosition)

  const controls = new TrackballControls(camera, renderer.domElement)
  controls.rotateSpeed = 3.0
  controls.zoomSpeed = 1.2
  controls.panSpeed = 0.8
  controls.staticMoving = !enableDamping // false → momentum/glide after release
  controls.dynamicDampingFactor = 0.15
  if (opts.minDistance != null) controls.minDistance = opts.minDistance
  if (opts.maxDistance != null) controls.maxDistance = opts.maxDistance
  controls.target.set(...target)

  const ctx: ThreeContext = { scene, camera, renderer, controls, container }

  // --- optional bloom post-processing ---
  let composer: EffectComposer | null = null
  if (opts.bloom) {
    composer = new EffectComposer(renderer)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        opts.bloom.strength ?? 0.9,
        opts.bloom.radius ?? 0.5,
        opts.bloom.threshold ?? 0,
      ),
    )
  }

  // --- sizing ---
  const resize = () => {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    renderer.setSize(w, h, false)
    composer?.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // TrackballControls caches the element's screen rect; refresh it on resize
    // or rotation math (which maps pixels → arcball) drifts.
    controls.handleResize()
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(container)

  // --- loop ---
  let updateFn: ((dt: number, elapsed: number) => void) | null = null
  const clock = new THREE.Clock()
  let raf = 0
  let fpsFrames = 0
  let fpsAcc = 0
  const tick = () => {
    raf = requestAnimationFrame(tick)
    const dt = clock.getDelta()
    const elapsed = clock.elapsedTime
    controls.update()
    updateFn?.(dt, elapsed)
    if (composer) composer.render()
    else renderer.render(scene, camera)

    if (opts.onFps) {
      fpsFrames++
      fpsAcc += dt
      if (fpsAcc >= 0.5) {
        opts.onFps(Math.round(fpsFrames / fpsAcc))
        fpsFrames = 0
        fpsAcc = 0
      }
    }
  }
  raf = requestAnimationFrame(tick)

  return {
    ctx,
    setUpdate(fn) {
      updateFn = fn
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      composer?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
