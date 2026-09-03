import { useEffect, useRef } from 'react'
import { Icon } from '@/components/Icon'
import { WIDGETS, type AnyWidgetDef } from './widgets'

/**
 * The list of widgets that can be added.
 *
 * It reads the registry rather than a list of its own, so a new widget appears
 * here the moment it is registered.
 */
export default function AddWidgetPicker({
  onPick,
  onClose
}: {
  onPick: (def: AnyWidgetDef) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred a tick, or the click that opened the picker closes it again.
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="home-picker" ref={ref} role="menu" aria-label="Add a widget">
      {WIDGETS.map((def) => (
        <button
          key={def.type}
          className="home-picker-row"
          role="menuitem"
          onClick={() => {
            onPick(def)
            onClose()
          }}
        >
          <Icon name={def.icon} size={16} className="home-picker-icon" />
          <span className="home-picker-copy">
            <span className="home-picker-name">{def.name}</span>
            <span className="home-picker-desc">{def.description}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
