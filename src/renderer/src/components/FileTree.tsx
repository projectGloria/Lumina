import React, { useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { TreeNode } from '@shared/types'
import { dirname } from '@shared/markdown-parse'
import { Icon } from './Icon'
import {
  confirmDelete,
  createNote,
  movePath,
  openNote,
  promptNewFolder,
  promptNewNote,
  promptRename,
  toggleStar
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

function flattenTree(nodes: TreeNode[], expanded: string[], depth = 0): FlatNode[] {
  const result: FlatNode[] = []
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.kind === 'folder' && expanded.includes(node.path)) {
      result.push(...flattenTree(node.children, expanded, depth + 1))
    }
  }
  return result
}

const Scroller = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>((props, ref) => {
  return (
    <div
      {...props}
      ref={ref}
      className={`panel-scroll tree ${props.className || ''}`}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return
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
  const expanded = useWorkspace((s) => s.expanded)

  // A tag filter turns the tree into a flat, filtered list; nesting would only
  // get in the way when you are looking at one topic.
  const filtered = useMemo(() => {
    if (!tagFilter) return null
    const paths = new Set(index.tags[tagFilter] ?? [])
    return [...paths].sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  }, [tagFilter, index])

  const flatTree = useMemo(() => {
    return flattenTree(tree, expanded)
  }, [tree, expanded])

  return (
    <>
      <PanelHeader
        title={tagFilter ? `#${tagFilter}` : 'Notes'}
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
              <button className="icon-btn" title="New note" onClick={() => promptNewNote('')}>
                <Icon name="plus" size={15} />
              </button>
              <button className="icon-btn" title="New folder" onClick={() => promptNewFolder('')}>
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
          <div className="panel-scroll tree"><p className="panel-empty">No notes tagged #{tagFilter}</p></div>
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
        <div className="panel-scroll tree"><p className="panel-empty">This vault is empty. Create your first note.</p></div>
      )}
    </>
  )
}

export function PanelHeader({
  title,
  actions
}: {
  title: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="panel-header">
      <span className="panel-title">{title}</span>
      <span className="panel-actions">{actions}</span>
    </div>
  )
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }): React.JSX.Element {
  if (node.kind === 'folder') return <FolderRow node={node} depth={depth} />
  return <FileRow path={node.path} depth={depth} />
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
  const [dropping, setDropping] = useState(false)

  return (
    <div
      className={`tree-row folder${dropping ? ' is-dropping' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => toggle(node.path)}
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
              { label: 'Show in file explorer', onSelect: () => void window.lumina.vault.reveal(node.path) },
              { separator: true, label: 'sep2' },
              { label: 'Delete folder', danger: true, onSelect: () => confirmDelete(node.path) }
            ]
          })
        }}
      >
        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
        <span className="tree-label truncate">{node.name}</span>
      </div>
  )
}

function FileRow({ path, depth }: { path: string; depth: number }): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const starred = useSettings((s) => s.settings.starred.includes(path))
  const dirty = useEditor((s) => {
    const b = s.buffers[path]
    return !!b && !b.loading && b.content !== b.saved
  })

  const isActive = tabs[activeTab]?.path === path
  const title = titleOf(path)

  return (
    <div
      className={`tree-row file${isActive ? ' is-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 + 16 }}
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
            { separator: true, label: 'sep1' },
            { label: 'Rename', onSelect: () => promptRename(path) },
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
      <span className="tree-label truncate">{title}</span>
      {dirty ? <span className="tree-dot" title="Unsaved changes" /> : null}
      {starred ? <Icon name="star" size={12} className="tree-star" /> : null}
    </div>
  )
}

async function duplicate(path: string): Promise<void> {
  const res = await window.lumina.notes.read(path)
  if (!res.ok || !res.data) {
    toast('Could not read the note', 'error')
    return
  }
  await createNote(dirname(path), `${titleOf(path)} copy`, res.data.content)
}
