import { useEffect, useRef, useState } from 'react'
import type { SearchHit } from '@shared/types'
import { Icon } from './Icon'
import { PanelHeader } from './FileTree'
import { openNote } from '../lib/actions'
import { useUi } from '../store/uiStore'
import { useWorkspace } from '../store/workspaceStore'

export default function SearchPanel(): React.JSX.Element {
  const query = useUi((s) => s.searchQuery)
  const setQuery = useUi((s) => s.setSearchQuery)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const leftPanel = useWorkspace((s) => s.leftPanel)

  useEffect(() => {
    if (leftPanel === 'search') input.current?.focus()
  }, [leftPanel])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    // Debounced so a fast typist does not queue a search per keystroke.
    const timer = setTimeout(() => {
      void window.lumina.search
        .query(q)
        .then((results) => {
          if (!cancelled) setHits(results)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 160)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const totalMatches = hits.reduce((sum, h) => sum + Math.max(1, h.matches.length), 0)

  return (
    <>
      <PanelHeader
        title="Search"
        actions={
          query ? (
            <button className="icon-btn" title="Clear" onClick={() => setQuery('')}>
              <Icon name="close" size={14} />
            </button>
          ) : null
        }
      />

      <div className="search-box">
        <Icon name="search" size={14} />
        <input
          ref={input}
          type="search"
          value={query}
          spellCheck={false}
          placeholder="Search notes…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim() ? (
        <div className="search-meta">
          {searching
            ? 'Searching…'
            : hits.length
              ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${hits.length} note${hits.length === 1 ? '' : 's'}`
              : 'No matches'}
        </div>
      ) : null}

      <div className="panel-scroll">
        {hits.map((hit) => (
          <div key={hit.path} className="search-hit">
            <button className="search-hit-title truncate" onClick={() => openNote(hit.path)}>
              {hit.title}
            </button>
            {hit.matches.map((m, i) => (
              <button
                key={`${m.line}-${i}`}
                className="search-hit-line"
                onClick={() => openNote(hit.path, { line: m.line })}
              >
                <span className="search-hit-lineno">{m.line + 1}</span>
                <span className="search-hit-text">
                  {m.text.slice(0, m.from)}
                  <mark>{m.text.slice(m.from, m.to)}</mark>
                  {m.text.slice(m.to)}
                </span>
              </button>
            ))}
          </div>
        ))}
        {!query.trim() ? (
          <p className="panel-empty">
            Search every note in the vault. Wrap a phrase in quotes to match it exactly.
          </p>
        ) : null}
      </div>
    </>
  )
}
