import React, { useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { TreeNode } from '@shared/types'
import { dirname } from '@shared/markdown-parse'
import { Icon, type IconName } from './Icon'
import PathIcon from './PathIcon'
import type { Settings } from '@shared/types'
import {
  confirmDelete,
  createNote,
  movePath,
  openNote,
  promptNewFolder,
  promptNewNote,
  promptRename,
  setColorOverride,
  setIconOverride,
  toggleStar,
  togglePin,
  uploadCustomIcon
} from '../lib/actions'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { toast, useUi } from '../store/uiStore'
import { titleOf, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

interface FlatNode {
  node: TreeNode
  depth: number
}

/** Reorders siblings for the file explorer: pinned first, then by the chosen sort order. */
function orderSiblings(nodes: TreeNode[], pinned: string[], sortOrder: Settings['sortOrder']): TreeNode[] {
  const pinnedSet = new Set(pinned)
  const sorted = [...nodes].sort((a, b) => {
    const aPinned = pinnedSet.has(a.path)
    const bPinned = pinnedSet.has(b.path)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    if (sortOrder === 'name' || a.kind === 'folder' || b.kind === 'folder') {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
    const key = sortOrder === 'created' ? 'createdAt' : 'mtime'
    return b[key] - a[key]
  })
  return sorted
}

function flattenTree(
  nodes: TreeNode[],
  expanded: string[],
  pinned: string[],
  sortOrder: Settings['sortOrder'],
  depth = 0
): FlatNode[] {
  const result: FlatNode[] = []
  for (const node of orderSiblings(nodes, pinned, sortOrder)) {
    result.push({ node, depth })
    if (node.kind === 'folder' && expanded.includes(node.path)) {
      result.push(...flattenTree(node.children, expanded, pinned, sortOrder, depth + 1))
    }
  }
  return result
}

const Scroller = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>((props, ref) => {
  const alwaysCount = useSettings((s) => s.settings.alwaysShowFolderCount)
  return (
    <div
      {...props}
      ref={ref}
      className={`panel-scroll tree${alwaysCount ? ' always-count' : ''} ${props.className || ''}`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.tree-row')) return
        e.preventDefault()
        useUi.getState().showContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: 'New note', onSelect: () => promptNewNote('') },
            { label: 'New folder', onSelect: () => promptNewFolder('') }
          ]
        })
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.tree-row')) return
        promptNewNote('')
      }}
      onDragOver={(e) => {
        if (e.target === e.currentTarget) e.preventDefault()
      }}
      onDrop={(e) => {
        const path = e.dataTransfer.getData('text/lumina-path')
        if (path && dirname(path) !== '') void movePath(path, '')
      }}
    />
  )
})
Scroller.displayName = 'Scroller'

export default function FileTree(): React.JSX.Element {
  const tree = useVault((s) => s.tree)
  const tagFilter = useUi((s) => s.tagFilter)
  const index = useVault((s) => s.index)
  const vault = useVault((s) => s.vault)
  const expanded = useWorkspace((s) => s.expanded)
  const pinned = useSettings((s) => s.settings.pinned)
  const sortOrder = useSettings((s) => s.settings.sortOrder)

  // A tag filter turns the tree into a flat, filtered list; nesting would only
  // get in the way when you are looking at one topic.
  const filtered = useMemo(() => {
    if (!tagFilter) return null
    const paths = new Set(index.tags[tagFilter] ?? [])
    return [...paths].sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  }, [tagFilter, index])

  const flatTree = useMemo(() => {
    return flattenTree(tree, expanded, pinned, sortOrder)
  }, [tree, expanded, pinned, sortOrder])

  return (
    <>
      <PanelHeader
        title={tagFilter ? `#${tagFilter}` : (vault?.name ?? 'Vault')}
        subtitle={tagFilter ? `${filtered?.length ?? 0} matches` : `${Object.keys(index.notes).length} files`}
        actions={
          tagFilter ? (
            <button
              className="icon-btn"
              title="Clear tag filter"
              onClick={() => useUi.getState().setTagFilter(null)}
            >
              <Icon name="close" size={14} />
            </button>
          ) : (
            <>
              <button
                className="icon-btn"
                data-tooltip="Sort by…"
                onClick={(e) => {
                  const set = (v: Settings['sortOrder']): void => useSettings.getState().patch({ sortOrder: v })
                  useUi.getState().showContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: sortOrder === 'name' ? 'Name (current)' : 'Name', onSelect: () => set('name') },
                      {
                        label: sortOrder === 'modified' ? 'Date modified (current)' : 'Date modified',
                        onSelect: () => set('modified')
                      },
                      {
                        label: sortOrder === 'created' ? 'Date created (current)' : 'Date created',
                        onSelect: () => set('created')
                      }
                    ]
                  })
                }}
              >
                <Icon name="outline" size={15} />
              </button>
              <button className="icon-btn panel-action-primary" data-tooltip="New note" onClick={() => promptNewNote('')}>
                <Icon name="plus" size={15} />
              </button>
              <button className="icon-btn" data-tooltip="New folder" onClick={() => promptNewFolder('')}>
                <Icon name="folderPlus" size={15} />
              </button>
            </>
          )
        }
      />

      {filtered ? (
        filtered.length ? (
          <Virtuoso
            style={{ flex: 1 }}
            components={{ Scroller }}
            data={filtered}
            itemContent={(_i, path) => <FileRow key={path} path={path} depth={0} />}
          />
        ) : (
          <div className="panel-scroll tree">
            <div className="empty-state empty-state-panel">
              <Icon name="tag" size={22} />
              <h2>No matches</h2>
              <p>No notes are tagged #{tagFilter}.</p>
            </div>
          </div>
        )
      ) : flatTree.length ? (
        <Virtuoso
          style={{ flex: 1 }}
          components={{ Scroller }}
          data={flatTree}
          itemContent={(_i, { node, depth }) => (
            <TreeRow key={node.path} node={node} depth={depth} />
          )}
        />
      ) : (
        <div className="panel-scroll tree">
          <div className="empty-state empty-state-panel">
            <Icon name="folder" size={22} />
            <h2>Empty vault</h2>
            <p>Create your first note to get started.</p>
            <button className="welcome-shortcut" onClick={() => promptNewNote('')}>
              <span>New note</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function PanelHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`panel-header${subtitle ? ' has-subtitle' : ''}`}>
      <span className="panel-heading-copy">
        <span className="panel-title">{title}</span>
        {subtitle ? <span className="panel-caption">{subtitle}</span> : null}
      </span>
      <span className="panel-actions">{actions}</span>
    </div>
  )
}

/** Small built-in set a file or folder's icon can be overridden to. */
const ICON_CHOICES: IconName[] = [
  'file',
  'folder',
  'book',
  'star',
  'tag',
  'hash',
  'link',
  'graph',
  'palette',
  'clock',
  'vault',
  'focus'
]

function showIconPicker(path: string, x: number, y: number, current: string | undefined): void {
  useUi.getState().showContextMenu({
    x,
    y,
    items: [
      ...ICON_CHOICES.map((name) => ({
        label: name === current ? `${name} (current)` : name,
        onSelect: () => setIconOverride(path, name)
      })),
      { separator: true, label: 'sep' },
      { label: 'Upload icon image…', onSelect: () => uploadCustomIcon(path) },
      { label: 'Reset to default', onSelect: () => setIconOverride(path, null) }
    ]
  })
}

/**
 * Small built-in palette a file or folder's icon color can be set to.
 *
 * These are stored per path and so cannot be tokens — one value has to read on
 * both grounds. They are the categorical set the rest of the app's palette
 * comes from, at the mid band that clears both: a pure `#f76b15` orange beside
 * a clay `--lum-folder` reads as a different app's colour, not another one of
 * ours.
 */
const COLOR_CHOICES: { label: string; value: string }[] = [
  { label: 'Red', value: '#e66767' },
  { label: 'Orange', value: '#d95926' },
  { label: 'Amber', value: '#c98500' },
  { label: 'Green', value: '#008300' },
  { label: 'Teal', value: '#199e70' },
  { label: 'Blue', value: '#3987e5' },
  { label: 'Purple', value: '#9085e9' },
  { label: 'Pink', value: '#d55181' },
  { label: 'Gray', value: '#97958d' }
]

/** Opens a native color input off-screen and resolves with the chosen color, or null if cancelled. */
function pickCustomColor(initial: string | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = initial ?? '#97958d'
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
      input.remove()
    }
    input.style.position = 'fixed'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    input.oninput = () => finish(input.value)
    input.onblur = () => finish(null)
    document.body.appendChild(input)
    input.click()
  })
}

function showColorPicker(path: string, x: number, y: number, current: string | undefined): void {
  useUi.getState().showContextMenu({
    x,
    y,
    items: [
      ...COLOR_CHOICES.map((c) => ({
        label: c.value === current ? `${c.label} (current)` : c.label,
        swatch: c.value,
        onSelect: () => setColorOverride(path, c.value)
      })),
      { separator: true, label: 'sep' },
      {
        label: 'Custom…',
        onSelect: () => void pickCustomColor(current).then((color) => color && setColorOverride(path, color))
      },
      { label: 'Reset to default', onSelect: () => setColorOverride(path, null) }
    ]
  })
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }): React.JSX.Element {
  if (node.kind === 'folder') return <FolderRow node={node} depth={depth} />
  return <FileRow path={node.path} depth={depth} />
}

function noteCount(nodes: TreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.kind === 'file' ? 1 : noteCount(node.children)),
    0
  )
}

function FolderRow({
  node,
  depth
}: {
  node: Extract<TreeNode, { kind: 'folder' }>
  depth: number
}): React.JSX.Element {
  const expanded = useWorkspace((s) => s.expanded.includes(node.path))
  const toggle = useWorkspace((s) => s.toggleExpanded)
  const iconOverride = useSettings((s) => s.settings.iconOverrides[node.path]) as
    | IconName
    | undefined
  const colorOverride = useSettings((s) => s.settings.colorOverrides[node.path])
  const pinned = useSettings((s) => s.settings.pinned.includes(node.path))
  const [dropping, setDropping] = useState(false)
  const notes = noteCount(node.children)

  return (
    <div
      className={`tree-row folder${dropping ? ' is-dropping' : ''}`}
      data-depth={depth}
        style={{
          // The extra step is the gutter the chevron hangs in; file rows at the
          // same depth start one indent to the left of their folder's label.
          paddingLeft: `calc(10px + ${depth + 1} * var(--lum-tree-indent))`,
          color: colorOverride
        }}
        onClick={() => toggle(node.path)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          promptNewNote(node.path)
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/lumina-path', node.path)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDropping(false)
          const path = e.dataTransfer.getData('text/lumina-path')
          if (path) void movePath(path, node.path)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          useUi.getState().showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: 'New note here', onSelect: () => promptNewNote(node.path) },
              { label: 'New subfolder', onSelect: () => promptNewFolder(node.path) },
              { separator: true, label: 'sep1' },
              { label: 'Rename folder', onSelect: () => promptRename(node.path) },
              {
                label: 'Change icon…',
                onSelect: () => showIconPicker(node.path, e.clientX, e.clientY, iconOverride)
              },
              {
                label: 'Change color…',
                onSelect: () => showColorPicker(node.path, e.clientX, e.clientY, colorOverride)
              },
              { label: pinned ? 'Unpin folder' : 'Pin folder', onSelect: () => togglePin(node.path) },
              { label: 'Show in file explorer', onSelect: () => void window.lumina.vault.reveal(node.path) },
              { separator: true, label: 'sep2' },
              { label: 'Delete folder', danger: true, onSelect: () => confirmDelete(node.path) }
            ]
          })
        }}
      >
        <Icon
          name={expanded ? 'chevronDown' : 'chevronRight'}
          size={14}
          className="tree-chevron"
        />
        <PathIcon path={node.path} kind="folder" size={16} className="tree-icon" />
        <span className="tree-label truncate">{node.name}</span>
        <span className="tree-hover-count">{notes}</span>
        {pinned ? <Icon name="pin" size={12} className="tree-pin" /> : null}
      </div>
  )
}

function FileRow({ path, depth }: { path: string; depth: number }): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const starred = useSettings((s) => s.settings.starred.includes(path))
  const pinned = useSettings((s) => s.settings.pinned.includes(path))
  const iconOverride = useSettings((s) => s.settings.iconOverrides[path]) as IconName | undefined
  const colorOverride = useSettings((s) => s.settings.colorOverrides[path])
  const showFileTypes = useSettings((s) => s.settings.showFileTypes)
  const dirty = useEditor((s) => {
    const b = s.buffers[path]
    return !!b && !b.loading && b.content !== b.saved
  })

  const isActive = tabs[activeTab]?.path === path
  const title = titleOf(path)

  return (
    <div
      className={`tree-row file${isActive ? ' is-active' : ''}`}
      data-depth={depth}
      style={{
        paddingLeft: `calc(10px + ${depth} * var(--lum-tree-indent))`,
        color: colorOverride
      }}
      onClick={(e) => openNote(path, { newTab: e.ctrlKey || e.metaKey })}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lumina-path', path)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        useUi.getState().showContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: 'Open in new tab', onSelect: () => openNote(path, { newTab: true }) },
            {
              label: starred ? 'Remove from starred' : 'Add to starred',
              onSelect: () => toggleStar(path)
            },
            { label: pinned ? 'Unpin' : 'Pin to top', onSelect: () => togglePin(path) },
            { separator: true, label: 'sep1' },
            { label: 'Rename', onSelect: () => promptRename(path) },
            {
              label: 'Change icon…',
              onSelect: () => showIconPicker(path, e.clientX, e.clientY, iconOverride)
            },
            {
              label: 'Change color…',
              onSelect: () => showColorPicker(path, e.clientX, e.clientY, colorOverride)
            },
            {
              label: 'Duplicate',
              onSelect: () => void duplicate(path)
            },
            {
              label: 'Copy link',
              onSelect: () => {
                void navigator.clipboard.writeText(`[[${title}]]`)
                toast('Link copied')
              }
            },
            { label: 'Show in file explorer', onSelect: () => void window.lumina.vault.reveal(path) },
            { separator: true, label: 'sep2' },
            { label: 'Delete', danger: true, onSelect: () => confirmDelete(path) }
          ]
        })
      }}
    >
      <PathIcon path={path} size={16} className="tree-icon" />
      <span className="tree-label truncate">
        {title}
        {showFileTypes ? <span className="tree-extension">{fileExtension(path)}</span> : null}
      </span>
      {dirty ? <span className="tree-dot" data-tooltip="Unsaved changes" /> : null}
      {pinned ? <Icon name="pin" size={12} className="tree-pin" /> : null}
      {starred ? <Icon name="star" size={14} className="tree-star" /> : null}
    </div>
  )
}

function fileExtension(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

async function duplicate(path: string): Promise<void> {
  const res = await window.lumina.notes.read(path)
  if (!res.ok || !res.data) {
    toast('Could not read the note', 'error')
    return
  }
  await createNote(dirname(path), `${titleOf(path)} copy`, res.data.content)
}
