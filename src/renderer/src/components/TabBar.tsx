import { useRef } from 'react'
import { Icon } from './Icon'
import PathIcon from './PathIcon'
import { closeOtherTabs, closeTab, confirmDelete, promptRename } from '../lib/actions'
import { commandTooltip, runCommand, useCommandHotkey } from '../lib/commands'
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
  const newNoteHotkey = useCommandHotkey('note.new')

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
      <ModeToggle />
      <button
        className="icon-btn tabbar-new"
        data-tooltip={commandTooltip('New note', newNoteHotkey)}
        aria-label="New note"
        onClick={() => runCommand('note.new')}
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}

/**
 * Edit / read for the active tab. Mirrors the `view.readMode` command rather
 * than toggling the store itself, so the button and the hotkey can never end
 * up doing different things.
 */
function ModeToggle(): React.JSX.Element | null {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const tab = tabs[activeTab]
  if (!tab) return null

  const reading = (tab.mode ?? 'edit') === 'read'
  const hotkey = useCommandHotkey('view.readMode')

  return (
    <button
      className={`icon-btn tabbar-mode${reading ? ' is-active' : ''}`}
      data-tooltip={`${reading ? 'Edit this note' : 'Read this note'}${hotkey ? `  (${hotkey})` : ''}`}
      aria-label={reading ? 'Switch to edit mode' : 'Switch to read mode'}
      aria-pressed={reading}
      onClick={() => runCommand('view.readMode')}
    >
      <Icon name={reading ? 'edit' : 'book'} size={15} />
    </button>
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
      data-tooltip={path}
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
      <PathIcon path={path} size={15} className="tab-icon" />
      <span className="tab-title truncate">{titleOf(path)}</span>
      <button
        className="tab-close"
        aria-label="Close tab"
        data-tooltip="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        {dirty ? <span className="tab-dot" data-tooltip="Unsaved changes" /> : <Icon name="close" size={12} />}
      </button>
    </div>
  )
}
