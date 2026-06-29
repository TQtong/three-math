import type { ReactNode } from 'react'

/** Frosted-glass container for a group of controls (used for the side panel). */
export function Panel({
  title,
  className = '',
  children,
}: {
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`panel ${className}`}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  )
}

/** A segmented button group — one option active at a time. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Labelled range slider. `value` is the raw integer slider value; format the
 * display however you like via `display`.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="row">
      <label>
        {label} <var>{display ?? value}</var>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/** A pill switch bound to a boolean. */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <div className="sw" />
    </div>
  )
}

/** Monospaced metric readouts (e.g. VERTICES / FPS) at the bottom of a panel. */
export function Readout({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="readout">
      {items.map((it) => (
        <div key={it.label}>
          {it.label}
          <b>{it.value}</b>
        </div>
      ))}
    </div>
  )
}
