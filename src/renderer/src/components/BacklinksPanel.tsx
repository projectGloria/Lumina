import { useMemo, useState } from 'react'
import type { LinkRef } from '@shared/types'
import { Icon, type IconName } from './Icon'
import { vaultUrl } from '../editor/resources'
import { createFromLink, openNote } from '../lib/actions'
import { useSettings } from '../store/settingsStore'
import { titleOf, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

/** The same icon/color a note or folder was given in the file explorer, shown next to it here too. */
function NoteBadge({ path }: { path: string }): React.JSX.Element {
  const iconOverride = useSettings((s) => s.settings.iconOverrides[path]) as IconName | undefined
  const colorOverride = useSettings((s) => s.settings.colorOverrides[path])
  const customIcon = useSettings((s) => s.settings.customIcons[path])

  return (
    <>
      {customIcon ? (
        <img src={vaultUrl(customIcon)} className="backlink-icon-img" alt="" />
      ) : iconOverride ? (
        <Icon
          name={iconOverride}
          size={13}
          className="backlink-icon"
          style={colorOverride ? { color: colorOverride } : undefined}
        />
      ) : null}
      <span style={colorOverride && !iconOverride && !customIcon ? { color: colorOverride } : undefined}>
        {titleOf(path)}
      </span>
    </>
  )
}

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

  /** Outgoing links that do resolve, grouped by target note. */
  const outgoing = useMemo(() => {
    if (!path) return []
    const entry = index.notes[path]
    if (!entry) return []
    const byTarget = new Map<string, LinkRef[]>()
    for (const link of entry.links) {
      if (!link.to) continue
      const list = byTarget.get(link.to)
      if (list) list.push(link)
      else byTarget.set(link.to, [link])
    }
    return [...byTarget.entries()].sort((a, b) => titleOf(a[0]).localeCompare(titleOf(b[0])))
  }, [path, index])
  const outgoingTotal = outgoing.reduce((sum, [, links]) => sum + links.length, 0)
  const [outgoingOpen, setOutgoingOpen] = useState(false)

  const total = grouped.reduce((sum, [, links]) => sum + links.length, 0)
  // The two directions look identical once rendered — the same note title over
  // the same kind of context line — so both lists carry a heading saying which
  // way the link points. Incoming ones start open: they are what the panel is
  // for, and they are the half you cannot see by reading the note itself.
  const [backlinksOpen, setBacklinksOpen] = useState(true)

  if (!path) {
    return <p className="panel-empty">Open a note to see what links to it.</p>
  }

  return (
    <div className="panel-scroll">
        {outgoingTotal ? (
          <div className="backlink-group">
            <button
              className="backlink-source truncate backlink-section"
              data-tooltip="Notes this note links to"
              onClick={() => setOutgoingOpen((v) => !v)}
            >
              <Icon name={outgoingOpen ? 'chevronDown' : 'chevronRight'} size={12} />
              <span>Links out · {outgoingTotal}</span>
            </button>
            {outgoingOpen
              ? outgoing.map(([target, links]) => (
                  <div key={target} className="backlink-entry">
                    <button className="backlink-source truncate" data-tooltip="Open note" onClick={() => openNote(target)}>
                      <NoteBadge path={target} />
                    </button>
                    {links.map((link, i) => (
                      <button
                        key={`${link.line}-${i}`}
                        className="backlink-context"
                        data-tooltip="Go to line"
                        onClick={() => openNote(path, { line: link.line })}
                      >
                        {link.context || '…'}
                      </button>
                    ))}
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {grouped.length ? (
          <div className="backlink-group">
            <button
              className="backlink-source truncate backlink-section"
              data-tooltip="Notes that link to this note"
              onClick={() => setBacklinksOpen((v) => !v)}
            >
              <Icon name={backlinksOpen ? 'chevronDown' : 'chevronRight'} size={12} />
              <span>Linked mentions · {total}</span>
            </button>
            {backlinksOpen
              ? grouped.map(([source, links]) => (
                  <div key={source} className="backlink-entry">
                    <button
                      className="backlink-source truncate"
                      data-tooltip="Open note"
                      onClick={() => openNote(source)}
                    >
                      <NoteBadge path={source} />
                    </button>
                    {links.map((link, i) => (
                      <button
                        key={`${link.line}-${i}`}
                        className="backlink-context"
                        data-tooltip="Go to line"
                        onClick={() => openNote(source, { line: link.line })}
                      >
                        {link.context || '…'}
                      </button>
                    ))}
                  </div>
                ))
              : null}
          </div>
        ) : (
          <div className="backlink-empty">
            <span className="backlink-empty-icon"><Icon name="link" size={16} /></span>
            <div className="backlink-empty-copy">
              <strong>No backlinks yet</strong>
              <span>Reference this note elsewhere with</span>
              <code title={`[[${titleOf(path)}]]`}>{`[[${titleOf(path)}]]`}</code>
            </div>
          </div>
        )}

        {unresolved.length ? (
          <div className="backlink-group unresolved-group">
            <div className="panel-subtitle">Links to notes that do not exist</div>
            {unresolved.map((link, i) => (
              <button
                key={`${link.target}-${i}`}
                className="backlink-context unresolved"
                data-tooltip="Create this note"
                onClick={() => void createFromLink(link.target, path)}
              >
                {link.target}
              </button>
            ))}
          </div>
        ) : null}
    </div>
  )
}
