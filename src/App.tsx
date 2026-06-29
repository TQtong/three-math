import { Suspense } from 'react'
import { demos, findDemo } from './demos/registry'
import { useHashRoute } from './useHashRoute'

export default function App() {
  const [route, navigate] = useHashRoute()
  const active = findDemo(route)
  const Demo = active.Component

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="head">
          <b>Three · Math</b>
          <span>数理与编程 · 可视化案例集</span>
        </div>
        <nav>
          {demos.map((d) => (
            <button
              key={d.id}
              className={`navlink ${d.id === active.id ? 'on' : ''}`}
              onClick={() => navigate(d.id)}
            >
              {d.titleZh} · {d.title}
              {d.tag && <small>{d.tag}</small>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="stage">
        <Suspense fallback={<div className="loading">loading…</div>}>
          {/* key forces a clean unmount/remount (full Three.js teardown) per demo */}
          <Demo key={active.id} />
        </Suspense>
      </main>
    </div>
  )
}
