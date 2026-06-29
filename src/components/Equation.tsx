import { useEffect, useRef } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Renders a LaTeX string with KaTeX. Imported via npm (CSS bundled) so there's
 * no CDN dependency. `throwOnError` is off — a bad formula degrades to red text
 * instead of crashing the demo.
 */
export function Equation({
  tex,
  displayMode = false,
  className = '',
}: {
  tex: string
  displayMode?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    katex.render(tex, ref.current, { throwOnError: false, displayMode })
  }, [tex, displayMode])

  return <div ref={ref} className={className} />
}
