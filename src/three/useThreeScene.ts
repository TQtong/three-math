import { useEffect, useRef } from 'react'
import { createHarness, type HarnessOptions, type ThreeContext } from './harness'

/**
 * What a demo's `setup` returns. `update` (optional) is the per-frame callback;
 * `dispose` frees whatever the demo allocated (geometries, materials, lines…).
 * A demo may extend this with imperative methods (e.g. `setMode`) that React UI
 * handlers call through the returned `instanceRef`.
 */
export interface DemoInstance {
  update?: (dt: number, elapsed: number) => void
  dispose?: () => void
}

export interface UseThreeSceneResult<T extends DemoInstance> {
  /** Attach to the element the canvas should fill. */
  containerRef: React.RefObject<HTMLDivElement>
  /** The live demo instance, available after mount; `null` before/after. */
  instanceRef: React.MutableRefObject<T | null>
}

/**
 * Mounts a {@link createHarness} into a container element and runs `setup` once
 * to build the demo. Handles the full lifecycle: the loop, fps reporting, and
 * teardown (dispose the instance, then the harness) on unmount.
 *
 * `setup` and `options` are captured at mount — this is a one-shot scene, which
 * is exactly what the gallery wants (switching demos unmounts/remounts).
 */
export function useThreeScene<T extends DemoInstance>(
  setup: (ctx: ThreeContext) => T,
  options?: HarnessOptions,
): UseThreeSceneResult<T> {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<T | null>(null)
  const setupRef = useRef(setup)
  setupRef.current = setup
  const optionsRef = useRef(options)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const harness = createHarness(container, optionsRef.current)
    const instance = setupRef.current(harness.ctx)
    instanceRef.current = instance
    harness.setUpdate(instance.update ?? null)

    return () => {
      harness.setUpdate(null)
      instance.dispose?.()
      harness.dispose()
      instanceRef.current = null
    }
  }, [])

  return { containerRef, instanceRef }
}
