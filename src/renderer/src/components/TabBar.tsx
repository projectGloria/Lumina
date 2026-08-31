import { useRef } from 'react'
import { Icon } from './Icon'
import { closeOtherTabs, closeTab, confirmDelete, promptRename } from '../lib/actions'
import { runCommand } from '../lib/commands'
import { useEditor } from '../store/editorStore'
import { useUi } from '../store/uiStore'
import { titleOf } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

export default function TabBar(): React.JSX.Element | null {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const activate = useWorkspace((s) => s.activateTab)
  const close = (i: number): void => void closeTab(i)
  const closeOthers = (i: number): void => void closeOtherTabs(i)
  const moveTab = useWorkspace((s) => s.moveTab)
  const dragFrom = useRef<number | null>(null)

  if (!tabs.length) return null

  return (
    <div className="tabbar" role="tablist">
      <div className="tabbar-scroll">
        {tabs.map((tab, i) => (
          <Tab
            key={`${tab.path}-${i}`}
            path={tab.path}
            active={i === activeTab}
            onActivate={() => activate(i)}
            onClose={() => close(i)}
            onDragStart={() => {
              dragFrom.current = i
            }}
            onDragOver={() => {
              if (dragFrom.current !== null && dragFrom.current !== i) {
                moveTab(dragFrom.current, i)
                dragFrom.current = i
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              useUi.getState().showContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Close', onSelect: () => close(i) },
                  { label: 'Close others', onSelect: () => closeOthers(i) },
                  { separator: true, label: 'sep1' },
                  {
                    label: 'Open in split view',
                    onSelect: () => useWorkspace.getState().openSplit(tab.path)
                  },
                  { label: 'Rename', onSelect: () => promptRename(tab.path) },
                  {
                    label: 'Show in file explorer',
                    onSelect: () => void window.lumina.vault.reveal(tab.path)
                  },
                  { separator: true, label: 'sep2' },
                  { label: 'Delete note', danger: true, onSelect: () => confirmDelete(tab.path) }
                ]
              })
            }}
          />
        ))}
      </div>
      <button
        className="icon-btn tabbar-new"
        title="New note  (Ctrl+N)"
        aria-label="New note"
        onClick={() => runCommand('note.new')}
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}

function Tab({
  path,
  active,
  onActivate,
  onClose,
  onDragStart,
  onDragOver,
  onContextMenu
}: {
  path: string
  active: boolean
  onActivate: () => void
  onClose: () => void
  onDragStart: () => void
  onDragOver: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const dirty = useEditor((s) => {
    const b = s.buffers[path]
    return !!b && !b.loading && b.content !== b.saved
  })

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab${active ? ' is-active' : ''}`}
      title={path}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onContextMenu={onContextMenu}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          onClose()
        } else if (e.button === 0) {
          onActivate()
        }
      }}
    >
      <span className="tab-title truncate">{titleOf(path)}</span>
      <button
        className="tab-close"
        aria-label="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        {dirty ? <span className="tab-dot" title="Unsaved changes" /> : <Icon name="close" size={12} />}
      </button>
    </div>
  )
}
