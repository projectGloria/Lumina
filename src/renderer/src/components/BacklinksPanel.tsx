import { useMemo } from 'react'
import type { LinkRef } from '@shared/types'
import { PanelHeader } from './FileTree'
import { createFromLink, openNote } from '../lib/actions'
import { titleOf, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

export default function BacklinksPanel(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const index = useVault((s) => s.index)
  const path = tabs[activeTab]?.path ?? null

  const grouped = useMemo(() => {
    if (!path) return []
    const links = index.backlinks[path] ?? []
    const bySource = new Map<string, LinkRef[]>()
    for (const link of links) {
      const list = bySource.get(link.from)
      if (list) list.push(link)
      else bySource.set(link.from, [link])
    }
    return [...bySource.entries()].sort((a, b) => titleOf(a[0]).localeCompare(titleOf(b[0])))
  }, [path, index])

  /** Outgoing links that point at notes which do not exist yet. */
  const unresolved = useMemo(() => {
    if (!path) return []
    const entry = index.notes[path]
    if (!entry) return []
    return entry.links.filter((l) => !l.to && l.kind === 'link')
  }, [path, index])

  const total = grouped.reduce((sum, [, links]) => sum + links.length, 0)

  if (!path) {
    return (
      <>
        <PanelHeader title="Backlinks" />
        <p className="panel-empty">Open a note to see what links to it.</p>
      </>
    )
  }

  return (
    <>
      <PanelHeader title={`Backlinks${total ? ` · ${total}` : ''}`} />
      <div className="panel-scroll">
        {grouped.length ? (
          grouped.map(([source, links]) => (
            <div key={source} className="backlink-group">
              <button className="backlink-source truncate" onClick={() => openNote(source)}>
                {titleOf(source)}
              </button>
              {links.map((link, i) => (
                <button
                  key={`${link.line}-${i}`}
                  className="backlink-context"
                  onClick={() => openNote(source, { line: link.line })}
                >
                  {link.context || '…'}
                </button>
              ))}
            </div>
          ))
        ) : (
          <p className="panel-empty">
            Nothing links here yet. Type <code>[[{titleOf(path)}]]</code> in another note.
          </p>
        )}

        {unresolved.length ? (
          <div className="backlink-group unresolved-group">
            <div className="panel-subtitle">Links to notes that do not exist</div>
            {unresolved.map((link, i) => (
              <button
                key={`${link.target}-${i}`}
                className="backlink-context unresolved"
                title="Create this note"
                onClick={() => void createFromLink(link.target, path)}
              >
                {link.target}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}
