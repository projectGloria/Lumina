/**
 * The widget grid.
 *
 * Positions are plain CSS grid placements; every rule about *where* a widget
 * may go lives in `@shared/homeLayout`, so this file only draws and reports
 * pointer gestures. While a drag is running the live rectangle lives in a ref
 * and is written to the DOM from a `requestAnimationFrame` callback — putting
 * a pointermove into React state re-renders every card on every frame, the
 * same reason `GraphView` keeps its node positions in refs.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeWidget } from '@shared/types'
import {
  canArrange,
  clampToColumns,
  fitToColumns,
  findFreeSpot,
  placeWidget,
  type GridRect,
  type GridSize
} from '@shared/homeLayout'
import { Icon } from '@/components/Icon'
import { HOME_COLUMNS, useHome } from '@/store/homeStore'
import AddWidgetPicker from './AddWidgetPicker'
import WidgetFrame from './WidgetFrame'
import { widgetDef, type AnyWidgetDef } from './widgets'

/**
 * How many columns the board draws at a given width. A four-column board in a
 * 500px pane is four unreadable slivers, so the layout is refolded rather than
 * scrolled sideways.
 */
const COLUMN_STEPS: { min: number; columns: number }[] = [
  { min: 900, columns: 4 },
  { min: 640, columns: 2 },
  { min: 0, columns: 1 }
]

const columnsFor = (width: number): number =>
  COLUMN_STEPS.find((step) => width >= step.min)?.columns ?? 1

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

interface Drag {
  mode: 'move' | 'resize'
  pointerId: number
  widget: HomeWidget
  min: GridSize
  origin: GridRect
  target: GridRect
  startX: number
  startY: number
  dx: number
  dy: number
  /** Pixels one column / one row advances by, gutter included. */
  stepX: number
  stepY: number
  gapX: number
  gapY: number
  el: HTMLElement
  frame: number
  stop: () => void
}

export default function HomeBoard(): React.JSX.Element {
  const layout = useHome((s) => s.layout)
  const editing = useHome((s) => s.editing)
  const commit = useHome((s) => s.commit)
  const removeWidget = useHome((s) => s.removeWidget)
  const setWidgetConfig = useHome((s) => s.setWidgetConfig)

  const boardRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [columns, setColumns] = useState(HOME_COLUMNS)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width) setColumns(columnsFor(width))
    })
    observer.observe(board)
    return () => observer.disconnect()
  }, [])

  // Nothing about the layout is editable in normal mode, so leaving edit mode
  // has to take the picker with it.
  useEffect(() => {
    if (!editing) setPicking(false)
  }, [editing])

  // Escape leaves edit mode, the same way it leaves focus mode.
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      useHome.getState().setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const minOf = (widget: HomeWidget): GridSize => widgetDef(widget.type)?.minSize ?? { w: 1, h: 1 }

  /**
   * What is on screen: the stored board refolded to the current width. Drags
   * commit against this list, so an arrangement made at two columns is stored
   * as a two-column board rather than being written back into four-column
   * coordinates it was never checked against.
   */
  const widgets = useMemo(
    () => fitToColumns(layout.widgets.map((w) => clampToColumns(w, columns, minOf(w))), columns),
    [layout.widgets, columns]
  )

  /**
   * Whether what is on screen may be stored as the board.
   *
   * False on a window narrower than the board was authored for, where every
   * widget has been clamped to fit — see `canArrange`. Moving and resizing are
   * inert there rather than silently flattening a wide layout; adding,
   * removing and per-widget settings all still work, because none of them has
   * to write the displayed coordinates back.
   */
  const arrangeable = canArrange(layout.columns, columns)

  const metrics = (): { stepX: number; stepY: number; gapX: number; gapY: number } => {
    const board = boardRef.current
    if (!board) return { stepX: 1, stepY: 1, gapX: 0, gapY: 0 }
    const styles = getComputedStyle(board)
    const gapX = parseFloat(styles.columnGap) || 0
    const gapY = parseFloat(styles.rowGap) || 0
    const rowHeight = parseFloat(styles.gridAutoRows) || 1
    return {
      stepX: (board.clientWidth + gapX) / Math.max(1, columns),
      stepY: rowHeight + gapY,
      gapX,
      gapY
    }
  }

  const draw = (): void => {
    const drag = dragRef.current
    if (!drag) return
    drag.frame = 0

    const ghost = ghostRef.current
    if (ghost) {
      ghost.hidden = false
      ghost.style.gridColumn = `${drag.target.x + 1} / span ${drag.target.w}`
      ghost.style.gridRow = `${drag.target.y + 1} / span ${drag.target.h}`
    }

    if (drag.mode === 'move') {
      drag.el.style.transform = `translate(${drag.dx}px, ${drag.dy}px)`
    } else {
      // A grid item's size comes from its area, so an explicit width and
      // height is the only way to preview a span it does not have yet.
      drag.el.style.width = `${drag.target.w * drag.stepX - drag.gapX}px`
      drag.el.style.height = `${drag.target.h * drag.stepY - drag.gapY}px`
    }
  }

  const schedule = (): void => {
    const drag = dragRef.current
    if (drag && !drag.frame) drag.frame = requestAnimationFrame(draw)
  }

  const beginDrag = (event: React.PointerEvent, widget: HomeWidget, mode: Drag['mode']): void => {
    if (!editing || !arrangeable || event.button !== 0 || dragRef.current) return
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-widget-id="${widget.id}"]`)
    if (!el) return
    event.preventDefault()
    event.stopPropagation()

    const { stepX, stepY, gapX, gapY } = metrics()
    const origin: GridRect = { x: widget.x, y: widget.y, w: widget.w, h: widget.h }

    const onMove = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      drag.dx = e.clientX - drag.startX
      drag.dy = e.clientY - drag.startY

      if (drag.mode === 'move') {
        drag.target = {
          ...drag.origin,
          x: clamp(drag.origin.x + Math.round(drag.dx / drag.stepX), 0, columns - drag.origin.w),
          y: Math.max(0, drag.origin.y + Math.round(drag.dy / drag.stepY))
        }
      } else {
        drag.target = {
          ...drag.origin,
          w: clamp(
            drag.origin.w + Math.round(drag.dx / drag.stepX),
            drag.min.w,
            columns - drag.origin.x
          ),
          h: Math.max(drag.min.h, drag.origin.h + Math.round(drag.dy / drag.stepY))
        }
      }
      schedule()
    }

    const finish =
      (keep: boolean) =>
      (): void => {
        const drag = dragRef.current
        if (!drag) return
        const { target, origin: from, widget: dragged, min } = drag
        drag.stop()
        const changed =
          target.x !== from.x || target.y !== from.y || target.w !== from.w || target.h !== from.h
        // A click that never moved must not re-author the board's columns.
        if (keep && changed) {
          commit(placeWidget(widgets, { ...dragged, ...target }, columns, min), columns)
        }
      }

    const onUp = finish(true)
    const onCancel = finish(false)

    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      const drag = dragRef.current
      if (drag) {
        if (drag.frame) cancelAnimationFrame(drag.frame)
        drag.el.classList.remove('is-dragging')
        drag.el.style.transform = ''
        drag.el.style.width = ''
        drag.el.style.height = ''
      }
      if (ghostRef.current) ghostRef.current.hidden = true
      dragRef.current = null
    }

    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      widget,
      min: minOf(widget),
      origin,
      target: origin,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      stepX,
      stepY,
      gapX,
      gapY,
      el,
      frame: 0,
      stop
    }

    el.classList.add('is-dragging')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    draw()
  }

  // A drag still in flight when the board unmounts would leave its window
  // listeners behind.
  useEffect(() => () => dragRef.current?.stop(), [])

  const nudge = (event: React.KeyboardEvent, widget: HomeWidget): void => {
    if (!editing) return
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeWidget(widget.id)
      return
    }

    // Removal works at any width; moving and resizing do not — they would have
    // to write the displayed coordinates back over the authored ones.
    const step = steps[event.key]
    if (!step || !arrangeable) return
    event.preventDefault()

    const [dx, dy] = step
    const min = minOf(widget)
    const target = event.shiftKey
      ? { ...widget, w: widget.w + dx, h: widget.h + dy }
      : { ...widget, x: Math.max(0, widget.x + dx), y: Math.max(0, widget.y + dy) }
    commit(placeWidget(widgets, target, columns, min), columns)
  }

  const addWidget = (def: AnyWidgetDef): void => {
    // Added into the board as authored rather than as displayed, so adding a
    // widget on a narrow window does not re-author the stored width. On a
    // window at least as wide as the board, the two are the same thing.
    const into = arrangeable ? columns : layout.columns
    const board = arrangeable ? widgets : layout.widgets
    const size = { w: Math.min(def.defaultSize.w, into), h: def.defaultSize.h }
    const spot = findFreeSpot(board, size, into)
    const widget: HomeWidget = {
      id: crypto.randomUUID(),
      type: def.type,
      ...spot,
      ...size,
      config: {}
    }
    commit(placeWidget(board, widget, into, def.minSize), into)
  }

  return (
    <>
      {editing ? (
        <div className="home-toolbar">
          <div className="home-toolbar-anchor">
            <button className="btn btn-primary" onClick={() => setPicking((open) => !open)}>
              <Icon name="plus" size={15} />
              <span>Add widget</span>
            </button>
            {picking ? <AddWidgetPicker onPick={addWidget} onClose={() => setPicking(false)} /> : null}
          </div>
          {arrangeable ? (
            <p className="home-toolbar-hint">
              Drag a card to move it, its corner to resize. A focused card moves with the arrow
              keys, resizes with Shift and an arrow, and goes away with Delete. Escape when you are
              done.
            </p>
          ) : (
            <p className="home-toolbar-hint">
              This board is arranged {layout.columns} columns wide and folded to {columns} to fit
              this window, so moving and resizing are off — rearranging here would flatten it.
              Widen the window to rearrange it, or re-arrange it at this width on purpose. Adding,
              removing and widget settings all still work.
              <button
                className="btn btn-small home-toolbar-reauthor"
                onClick={() => commit(widgets, columns)}
              >
                Rearrange at this width
              </button>
            </p>
          )}
        </div>
      ) : null}

      <div
        className={`home-board${editing ? ' is-editing' : ''}`}
        ref={boardRef}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {widgets.map((widget) => (
          <WidgetFrame
            key={widget.id}
            widget={widget}
            editing={editing}
            movable={arrangeable}
            style={{
              gridColumn: `${widget.x + 1} / span ${widget.w}`,
              gridRow: `${widget.y + 1} / span ${widget.h}`
            }}
            onRemove={() => removeWidget(widget.id)}
            onMoveStart={(e) => beginDrag(e, widget, 'move')}
            onResizeStart={(e) => beginDrag(e, widget, 'resize')}
            onKeyDown={(e) => nudge(e, widget)}
            setConfig={(patch) => setWidgetConfig(widget.id, patch)}
          />
        ))}
        <div className="home-ghost" ref={ghostRef} hidden aria-hidden="true" />
      </div>

      {!widgets.length ? (
        <div className="home-board-empty">
          <Icon name="grid" size={26} />
          <p>
            {editing
              ? 'Add a widget to start building this board.'
              : 'This board is empty. Choose Edit layout to add a widget.'}
          </p>
        </div>
      ) : null}
    </>
  )
}
