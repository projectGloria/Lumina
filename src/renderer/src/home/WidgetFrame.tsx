/**
 * The card every widget is drawn inside.
 *
 * It owns the chrome — title, overflow menu, the edit-mode handles — and an
 * error boundary, because one widget throwing must never take the board down
 * with it. Widgets themselves render only their contents.
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import type { HomeWidget } from '@shared/types'
import { Icon } from '@/components/Icon'
import { useUi } from '@/store/uiStore'
import { widgetDef } from './widgets'

interface Props {
  widget: HomeWidget
  editing: boolean
  /**
   * Whether this board may be rearranged at the width it is drawn at. False on
   * a window narrower than the board was authored for, where the move grip and
   * the resize corner are left out rather than offered and ignored.
   */
  movable: boolean
  style: React.CSSProperties
  onRemove: () => void
  onMoveStart: (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  setConfig: (patch: Record<string, unknown>) => void
}

export default function WidgetFrame({
  widget,
  editing,
  movable,
  style,
  onRemove,
  onMoveStart,
  onResizeStart,
  onKeyDown,
  setConfig
}: Props): React.JSX.Element {
  const [showSettings, setShowSettings] = useState(false)
  const def = widgetDef(widget.type)

  if (!def) {
    // Kept, never dropped: the layout is the user's arrangement, and a type
    // this build does not know may well be one a later build brings back.
    return (
      <article className="home-widget is-unknown" data-widget-id={widget.id} style={style}>
        <div className="home-widget-body home-widget-unknown">
          <Icon name="info" size={18} />
          <p>
            Unknown widget <code>{widget.type}</code>
          </p>
          <button className="btn btn-small btn-danger" onClick={onRemove}>
            Remove
          </button>
        </div>
      </article>
    )
  }

  const config = { ...def.defaultConfig, ...widget.config }
  const Settings = def.Settings

  const openMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    useUi.getState().showContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(Settings
          ? [{ label: 'Widget settings', onSelect: () => setShowSettings((open) => !open) }]
          : []),
        ...(editing
          ? [{ label: 'Remove widget', danger: true, onSelect: onRemove }]
          : [])
      ]
    })
  }

  const hasMenu = !!Settings || editing

  return (
    <article
      className={`home-widget${editing ? ' is-editing' : ''}${
        editing && !movable ? ' is-locked' : ''
      }`}
      data-widget-id={widget.id}
      style={style}
      tabIndex={editing ? 0 : -1}
      onKeyDown={onKeyDown}
      aria-label={editing ? `${def.name} widget` : undefined}
    >
      <header
        className="home-widget-head"
        onPointerDown={editing && movable ? onMoveStart : undefined}
      >
        {editing && movable ? (
          <button
            className="home-widget-grip"
            aria-label={`Move ${def.name}`}
            onPointerDown={onMoveStart}
          >
            <Icon name="dots" size={14} />
          </button>
        ) : (
          <Icon name={def.icon} size={14} className="home-widget-icon" />
        )}
        <h2 className="home-widget-title truncate">{def.name}</h2>
        {hasMenu ? (
          <button className="icon-btn home-widget-menu" aria-label={`${def.name} options`} onClick={openMenu}>
            <Icon name="dots" size={14} />
          </button>
        ) : null}
      </header>

      {showSettings && Settings ? (
        <div className="home-widget-settings">
          <Settings config={config} setConfig={setConfig} />
          <button className="btn btn-small" onClick={() => setShowSettings(false)}>
            Done
          </button>
        </div>
      ) : null}

      <div className="home-widget-body">
        <WidgetErrorBoundary type={widget.type}>
          <def.Component id={widget.id} config={config} setConfig={setConfig} />
        </WidgetErrorBoundary>
      </div>

      {editing && movable ? (
        <button
          className="home-widget-resize"
          aria-label={`Resize ${def.name}`}
          onPointerDown={onResizeStart}
        />
      ) : null}
    </article>
  )
}

/** One widget's failure, contained to its own card. */
class WidgetErrorBoundary extends Component<{ type: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[lumina] home widget "${this.props.type}" failed`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <p className="home-widget-empty">This widget stopped working.</p>
  }
}
