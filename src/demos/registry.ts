import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * One entry per visualization. To add a case: drop a folder under `src/demos/`,
 * export a default React component from it, and append an entry here. The
 * sidebar, routing, and code-splitting all key off this list — nothing else to
 * touch.
 */
export interface DemoEntry {
  /** URL slug (used in the hash route, e.g. #/klein-bottle). */
  id: string
  title: string
  titleZh: string
  /** Short uppercase classifier shown under the title. */
  tag?: string
  Component: LazyExoticComponent<ComponentType>
}

export const demos: DemoEntry[] = [
  {
    id: 'klein-bottle',
    title: 'Klein Bottle',
    titleZh: '克莱因瓶',
    tag: 'non-orientable surface',
    Component: lazy(() => import('./klein-bottle/KleinBottle')),
  },
  {
    id: 'four-wing-lorenz',
    title: 'Four-Wing Lorenz Attractor',
    titleZh: '四翼洛伦兹吸引子',
    tag: 'chaotic attractor',
    Component: lazy(() => import('./four-wing-lorenz/FourWingLorenz')),
  },
]

export function findDemo(id: string | null | undefined): DemoEntry {
  return demos.find((d) => d.id === id) ?? demos[0]
}
