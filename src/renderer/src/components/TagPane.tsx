import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { PanelHeader } from './FileTree'
import { useUi } from '../store/uiStore'
import { useVault } from '../store/vaultStore'

interface TagNode {
  /** Full tag path, e.g. `project/gloria`. */
  full: string
  /** Last segment, shown in the row. */
  label: string
  count: number
  children: TagNode[]
}

/** Build the nested structure implied by `#parent/child` names. */
function buildTagTree(tags: Record<string, string[]>): TagNode[] {
  const roots: TagNode[] = []
  const byPath = new Map<string, TagNode>()

  for (const full of Object.keys(tags).sort()) {
    const segments = full.split('/')
    let parentList = roots
    let prefix = ''

    for (let i = 0; i < segments.length; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]
      let node = byPath.get(prefix)
      if (!node) {
        node = { full: prefix, label: segments[i], count: tags[prefix]?.length ?? 0, children: [] }
        byPath.set(prefix, node)
        parentList.push(node)
      }
      parentList = node.children
    }
  }

  return roots
}

export default function TagPane(): React.JSX.Element {
  const index = useVault((s) => s.index)
  const tagFilter = useUi((s) => s.tagFilter)
  const setTagFilter = useUi((s) => s.setTagFilter)
  const tree = useMemo(() => buildTagTree(index.tags), [index.tags])
  const total = Object.keys(index.tags).length

  return (
    <>
      <PanelHeader title="Tags"
        actions={
          tagFilter ? (
            <button className="icon-btn" title="Clear filter" onClick={() => setTagFilter(null)}>
              <Icon name="close" size={14} />
            </button>
          ) : null
        }
      />
      <div className="panel-scroll tree">
        {total ? (
          tree.map((node) => <TagRow key={node.full} node={node} depth={0} />)
        ) : (
          <p className="panel-empty">
            No tags yet. Write <code>#like-this</code> in a note.
          </p>
        )}
      </div>
    </>
  )
}

function TagRow({ node, depth }: { node: TagNode; depth: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(depth === 0)
  const active = useUi((s) => s.tagFilter) === node.full
  const setTagFilter = useUi((s) => s.setTagFilter)
  const hasChildren = node.children.length > 0

  return (
    <>
      <div
        className={`tree-row tag-row${active ? ' is-active' : ''}`}
        data-tooltip={`Filter by #${node.full}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setTagFilter(active ? null : node.full)}
      >
        {hasChildren ? (
          <button
            className="tree-twisty"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            data-tooltip={expanded ? 'Collapse nested tags' : 'Expand nested tags'}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
          </button>
        ) : (
          <span className="tree-twisty" />
        )}
        <span className="tree-label truncate">#{node.label}</span>
        <span className="tree-count">{node.count}</span>
      </div>
      {expanded
        ? node.children.map((child) => <TagRow key={child.full} node={child} depth={depth + 1} />)
        : null}
    </>
  )
}
