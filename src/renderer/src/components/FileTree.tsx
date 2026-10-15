import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
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

/**
 * Keyboard navigation for the tree.
 *
 * The explorer was the one primary surface with no keyboard route in at all —
 * rows were bare `<div>`s with an `onClick`, so browsing the vault, expanding a
 * folder, and every action that lives only in the row's context menu were
 * mouse-only. `tabIndex` appeared exactly once in the whole renderer.
 *
 * Roving focus rather than one tab stop per row: the tree is virtualised, so a
 * focused row can be unmounted by scrolling, and the authoritative "which row
 * has focus" has to live in React state rather than in the DOM. The context
 * carries it down to rows without threading props through `itemContent`.
 */
interface TreeNav {
  focused: string | null
  setFocused: (path: string | null) => void
  /** Ordered paths of every row currently on screen, for Up/Down. */
  order: string[]
}

const TreeNavContext = React.createContext<TreeNav>({
  focused: null,
  setFocused: () => {},
  order: []
})

/**
 * Wire one row up to the tree's keyboard model.
 *
 * Returns the props every row needs: roving `tabIndex`, the `treeitem` role,
 * and a handler for the keys that apply to whichever row has focus. Rows are
 * focused imperatively when `focused` names them, which is what makes Up and
 * Down actually move the caret rather than just a highlight.
 */
function useTreeRow(
  path: string,
  opts: { folder?: boolean; expanded?: boolean; onActivate: () => void; onToggle?: () => void }
): {
  ref: React.RefObject<HTMLDivElement | null>
  tabIndex: number
  role: 'treeitem'
  'aria-expanded'?: boolean
  onKeyDown: (e: React.KeyboardEvent) => void
  onFocus: () => void
} {
  const { focused, setFocused, order } = React.useContext(TreeNavContext)
  const ref = useRef<HTMLDivElement>(null)
  const isFocused = focused === path

  useEffect(() => {
    if (isFocused && ref.current && document.activeElement !== ref.current) ref.current.focus()
  }, [isFocused])

  const move = (delta: number): void => {
    const i = order.indexOf(path)
    if (i === -1) return
    const next = order[Math.max(0, Math.min(order.length - 1, i + delta))]
    if (next) setFocused(next)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); return
      case 'ArrowUp': e.preventDefault(); move(-1); return
      case 'Home': e.preventDefault(); if (order[0]) setFocused(order[0]); return
      case 'End': e.preventDefault(); if (order.length) setFocused(order[order.length - 1]); return
      case 'Enter':
      case ' ':
        e.preventDefault()
        opts.onActivate()
        return
      case 'ArrowRight':
        if (!opts.folder) return
        e.preventDefault()
        if (!opts.expanded) opts.onToggle?.()
        else move(1)
        return
      case 'ArrowLeft':
        if (opts.folder && opts.expanded) {
          e.preventDefault()
          opts.onToggle?.()
          return
        }
        // Not a folder, or already closed: step out to the parent row.
        e.preventDefault()
        {
          const parent = dirname(path)
          if (parent && order.includes(parent)) setFocused(parent)
        }
        return
      case 'F2':
        e.preventDefault()
        promptRename(path)
        return
      case 'Delete':
        e.preventDefault()
        confirmDelete(path)
        return
      default:
        // Shift+F10 and the dedicated Menu key are how a keyboard opens a
        // context menu everywhere else; the row's own handler reads the
        // pointer position, so synthesise one from the row's box.
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault()
          const rect = ref.current?.getBoundingClientRect()
          ref.current?.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: rect ? rect.left + 24 : 0,
              clientY: rect ? rect.bottom : 0
            })
          )
        }
    }
  }

  return {
    ref,
    tabIndex: isFocused || (focused === null && order[0] === path) ? 0 : -1,
    role: 'treeitem',
    ...(opts.folder ? { 'aria-expanded': !!opts.expanded } : {}),
    onKeyDown,
    onFocus: () => setFocused(path)
  }
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
      role="tree"
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

  const [focused, setFocused] = useState<string | null>(null)
  // The rows Up/Down step through, in the order they are drawn.
  const order = useMemo(
    () => (filtered ? filtered : flatTree.map((row) => row.node.path)),
    [filtered, flatTree]
  )
  const nav = useMemo<TreeNav>(() => ({ focused, setFocused, order }), [focused, order])

  // Scroll a row reached by keyboard into view — it may be outside the
  // virtualised window entirely, in which case it has no DOM node to focus
  // until Virtuoso renders it.
  const listRef = useRef<VirtuosoHandle>(null)
  useEffect(() => {
    if (!focused) return
    const index = order.indexOf(focused)
    if (index >= 0) listRef.current?.scrollIntoView({ index, behavior: 'auto' })
  }, [focused, order])

  return (
    <TreeNavContext.Provider value={nav}>
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
            ref={listRef}
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
          ref={listRef}
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
    </TreeNavContext.Provider>
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

/**
 * Opens a native color input off-screen and resolves with the chosen color, or
 * null if cancelled.
 *
 * On `change`, not `input`: Chromium fires `input` continuously as the pointer
 * moves inside the picker, so resolving there settled on the first colour the
 * cursor happened to pass over and then removed the element, closing the picker
 * before the user had chosen anything. `change` fires once, on confirmation.
 *
 * `cancel` rather than `blur` for the same reason `pickImageFile` uses it:
 * opening the native picker moves focus off the input, so a `blur` handler
 * cancelled the interaction it was meant to be waiting on.
 */
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
    input.onchange = () => finish(input.value)
    input.oncancel = () => finish(null)
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
  // Recursive walk of the whole subtree, so it does not belong in the render
  // body — this row re-renders on every settings change, and a top-level folder
  // counts the entire vault.
  const notes = useMemo(() => noteCount(node.children), [node.children])

  const nav = useTreeRow(node.path, {
    folder: true,
    expanded,
    onActivate: () => toggle(node.path),
    onToggle: () => toggle(node.path)
  })

  return (
    <div
      {...nav}
      className={`tree-row folder${dropping ? ' is-dropping' : ''}`}
      data-depth={depth}
      aria-level={depth + 1}
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

  const nav = useTreeRow(path, { onActivate: () => openNote(path) })

  return (
    <div
      {...nav}
      className={`tree-row file${isActive ? ' is-active' : ''}`}
      data-depth={depth}
      aria-level={depth + 1}
      aria-selected={isActive}
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
