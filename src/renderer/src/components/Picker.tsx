import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { highlight } from '../lib/fuzzy'

export interface PickerItem {
  id: string
  label: string
  /** Indices in `label` that matched the query. */
  indices?: number[]
  detail?: string
  hint?: string[]
  section?: string
  onSelect: () => void
}

/**
 * The shared body of the quick switcher and command palette.
 *
 * Both are the same interaction — type, arrow, Enter — so they share the
 * keyboard handling, scroll-into-view and rendering, and differ only in what
 * they put in the list.
 */
export default function Picker({
  placeholder,
  items,
  query,
  onQueryChange,
  onClose,
  emptyMessage,
  footer
}: {
  placeholder: string
  items: PickerItem[]
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
  emptyMessage?: string
  footer?: React.ReactNode
}): React.JSX.Element {
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, items])

  const choose = (index: number): void => {
    const item = items[index]
    if (!item) return
    onClose()
    item.onSelect()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setCursor((c) => (items.length ? (c + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(cursor)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Home') {
      setCursor(0)
    } else if (e.key === 'End') {
      setCursor(Math.max(0, items.length - 1))
    }
  }

  let lastSection: string | undefined

  return (
    <div className="overlay top" onMouseDown={onClose}>
      <div className="modal picker" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={input}
          className="picker-input"
          type="text"
          value={query}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
        />

        <div className="picker-list" ref={listRef} role="listbox">
          {items.length ? (
            items.map((item, i) => {
              const showSection = item.section && item.section !== lastSection
              lastSection = item.section
              return (
                <div key={item.id}>
                  {showSection ? <div className="picker-section">{item.section}</div> : null}
                  <div
                    role="option"
                    aria-selected={i === cursor}
                    data-cursor={i === cursor}
                    className={`picker-item${i === cursor ? ' is-active' : ''}`}
                    onMouseMove={() => setCursor(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(i)
                    }}
                  >
                    <span className="picker-label truncate">
                      {highlight(item.label, item.indices ?? []).map((part, k) =>
                        part.hit ? <mark key={k}>{part.text}</mark> : <span key={k}>{part.text}</span>
                      )}
                    </span>
                    {item.detail ? <span className="picker-detail truncate">{item.detail}</span> : null}
                    {item.hint?.length ? (
                      <span className="picker-hint">
                        {item.hint.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="picker-empty">{emptyMessage ?? 'No results'}</div>
          )}
        </div>

        {footer ? <div className="picker-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
