import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUi } from '../store/uiStore'

export default function ContextMenu(): React.JSX.Element | null {
  const menu = useUi((s) => s.contextMenu)
  const hide = useUi((s) => s.hideContextMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Keep the menu on screen when it opens near an edge.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - rect.width - 8),
      y: Math.min(menu.y, window.innerHeight - rect.height - 8)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (): void => hide()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, hide])

  if (!menu) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="context-menu-sep" />
        ) : (
          <button
            key={item.label}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            role="menuitem"
            onClick={() => {
              hide()
              item.onSelect?.()
            }}
          >
            {item.swatch ? (
              <span className="context-menu-swatch" style={{ background: item.swatch }} />
            ) : null}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
