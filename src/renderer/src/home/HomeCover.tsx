/**
 * The picture across the top of the board.
 *
 * The image is a vault file served over `lumina://`, the same scheme every
 * other vault image uses, so nothing here widens the CSP or reaches outside
 * the vault. Repositioning drags in a ref and is written to the DOM from a
 * `requestAnimationFrame` callback, then committed once on pointerup — the
 * same discipline the widget grid uses, for the same reason.
 */
import { useEffect, useRef } from 'react'
import type { HomeCover as HomeCoverState } from '@shared/types'
import { Icon } from '@/components/Icon'
import { vaultUrl } from '@/editor/resources'
import { pickHomeCover } from '@/lib/actions'
import { useHome } from '@/store/homeStore'

interface Drag {
  pointerId: number
  startY: number
  startPosition: number
  position: number
  height: number
  frame: number
  stop: () => void
}

export default function HomeCover({
  cover,
  editing,
  onEdit,
  onDone
}: {
  cover: HomeCoverState
  /** Cover adjustment, which is its own mode — see the note on `onDone`. */
  editing: boolean
  onEdit: () => void
  /**
   * Finish with the cover.
   *
   * Deliberately separate from the board's Edit layout: adding a picture is
   * one small job, and it ends with its own button rather than by leaving a
   * mode that also governs every widget.
   */
  onDone: () => void
}): React.JSX.Element {
  const setCover = useHome((s) => s.setCover)
  const elRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  // A drag still in flight when the board unmounts would leave its listeners.
  useEffect(() => () => dragRef.current?.stop(), [])

  const draw = (): void => {
    const drag = dragRef.current
    if (!drag || !elRef.current) return
    drag.frame = 0
    elRef.current.style.backgroundPositionY = `${drag.position}%`
  }

  const beginDrag = (event: React.PointerEvent): void => {
    const el = elRef.current
    if (!editing || event.button !== 0 || dragRef.current || !el) return
    event.preventDefault()

    const onMove = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      // Dragging the image down reveals more of its top, so the focal point
      // moves the opposite way to the pointer.
      const delta = ((e.clientY - drag.startY) / drag.height) * 100
      drag.position = Math.min(Math.max(Math.round(drag.startPosition - delta), 0), 100)
      if (!drag.frame) drag.frame = requestAnimationFrame(draw)
    }

    const finish = (keep: boolean) => (): void => {
      const drag = dragRef.current
      if (!drag) return
      const { position } = drag
      drag.stop()
      if (keep && position !== cover.position) setCover({ ...cover, position })
    }

    const onUp = finish(true)
    const onCancel = finish(false)

    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      const drag = dragRef.current
      if (drag?.frame) cancelAnimationFrame(drag.frame)
      el.classList.remove('is-dragging')
      dragRef.current = null
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPosition: cover.position,
      position: cover.position,
      height: el.clientHeight || 1,
      frame: 0,
      stop
    }

    el.classList.add('is-dragging')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const replace = (): void => {
    void (async () => {
      const path = await pickHomeCover()
      // Position is deliberately kept: swapping one photo for another usually
      // means the same framing was wanted.
      if (path) setCover({ ...cover, path })
    })()
  }

  return (
    <div className={`home-cover${editing ? ' is-editing' : ''}`}>
      <div
        ref={elRef}
        className="home-cover-image"
        role="img"
        aria-label="Home cover picture"
        style={{
          backgroundImage: `url("${vaultUrl(cover.path)}")`,
          backgroundPositionY: `${cover.position}%`
        }}
        onPointerDown={beginDrag}
      />

      {editing ? (
        <div className="home-cover-actions">
          <span className="home-cover-hint">Drag the picture to reposition it</span>
          <button className="btn btn-small" onClick={replace}>
            <Icon name="image" size={13} />
            <span>Change</span>
          </button>
          <button
            className="btn btn-small btn-danger"
            onClick={() => {
              setCover(null)
              onDone()
            }}
          >
            <Icon name="trash" size={13} />
            <span>Remove</span>
          </button>
          <button className="btn btn-small btn-primary" onClick={onDone}>
            <Icon name="check" size={13} />
            <span>Done</span>
          </button>
        </div>
      ) : (
        <button className="home-cover-edit" onClick={onEdit} data-tooltip="Adjust this picture">
          <Icon name="image" size={13} />
          <span>Edit cover</span>
        </button>
      )}
    </div>
  )
}
