import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUi } from '../store/uiStore'

export default function ContextMenu(): React.JSX.Element | null {
  const menu = useUi((s) => s.contextMenu)
  const hide = useUi((s) => s.hideContextMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Keep the menu on screen when it opens near an edge. Clamped at both ends:
  // a menu wider than the window used to be pushed off the left edge, taking
  // its labels with it.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))
    })
  }, [menu])

  /**
   * Focus the first item on open.
   *
   * The menu carries correct `menu`/`menuitem` roles and real buttons, but
   * nothing ever moved focus into it — so every action that lives only here
   * (rename, duplicate, change icon, change colour, pin, copy link, delete) was
   * mouse-only. Focus goes back to whatever opened it on close.
   */
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!menu || !ref.current) return
    opener.current = document.activeElement as HTMLElement | null
    ref.current.querySelector<HTMLButtonElement>('button')?.focus()
    return () => opener.current?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (): void => hide()

    const items = (): HTMLButtonElement[] =>
      Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        hide()
        return
      }
      // Arrow navigation, wrapping, as a menu is expected to behave. Home and
      // End included because a ten-item file menu is long enough to want them.
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
      if (!keys.includes(e.key)) return
      const all = items()
      if (!all.length) return
      e.preventDefault()
      const current = all.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        e.key === 'Home' ? 0
        : e.key === 'End' ? all.length - 1
        : e.key === 'ArrowDown' ? (current + 1 + all.length) % all.length
        : (current - 1 + all.length) % all.length
      all[next]?.focus()
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
          <div key={`sep-${i}`} className="context-menu-sep" role="separator" />
        ) : (
          <button
            key={`${item.label}-${i}`}
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
