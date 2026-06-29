import { useEffect, useState } from 'react'

/**
 * Minimal hash router: reads the slug after `#/` and re-renders on change.
 * Returns the current slug and a setter that updates `location.hash`.
 * Kept dependency-free on purpose — the gallery only needs one level of routing.
 */
export function useHashRoute(): [string, (id: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '')
  const [route, setRoute] = useState(read)

  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = (id: string) => {
    window.location.hash = `/${id}`
  }

  return [route, navigate]
}
