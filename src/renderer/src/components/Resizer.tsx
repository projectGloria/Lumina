import { useCallback, useEffect, useRef } from 'react'

/**
 * A draggable divider between a sidebar and the editor.
 *
 * Pointer capture keeps the drag alive over the CodeMirror surface, which
 * would otherwise swallow the move events.
 */
export default function Resizer({
  side,
  width,
  onResize
}: {
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
}): React.JSX.Element {
  const dragging = useRef(false)
  const start = useRef({ x: 0, width: 0 })

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = true
      start.current = { x: e.clientX, width }
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const delta = e.clientX - start.current.x
      onResize(start.current.width + (side === 'left' ? delta : -delta))
    },
    [onResize, side]
  )

  const stop = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(
    () => () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    },
    []
  )

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onResize(side === 'left' ? 260 : 300)}
    />
  )
}
