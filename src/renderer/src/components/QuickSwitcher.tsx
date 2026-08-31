import { useDeferredValue, useMemo, useState } from 'react'
import Picker, { type PickerItem } from './Picker'
import { createNote, openNote } from '../lib/actions'
import { fuzzyMatch } from '../lib/fuzzy'
import { dirname } from '@shared/markdown-parse'
import { useUi } from '../store/uiStore'
import { useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

export default function QuickSwitcher(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const queryIsStale = deferredQuery !== query
  const close = useUi((s) => s.closeModal)
  const notes = useVault((s) => s.index.notes)
  const history = useWorkspace((s) => s.history)

  const items = useMemo<PickerItem[]>(() => {
    // Never let Enter choose a result calculated for the previous query.
    if (queryIsStale) return []
    const entries = Object.values(notes)

    if (!deferredQuery.trim()) {
      // With no query, offer where you have actually been, most recent first.
      const recent = [...new Set([...history].reverse())].filter((p) => notes[p]).slice(0, 12)
      const rest = entries
        .filter((e) => !recent.includes(e.path))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)
      return [...recent.map((p) => notes[p]), ...rest].map((entry) => toItem(entry))
    }

    const scored = entries
      .map((entry) => {
        const onTitle = fuzzyMatch(deferredQuery, entry.title)
        if (onTitle) return { entry, score: onTitle.score + 40, indices: onTitle.indices }
        const onPath = fuzzyMatch(deferredQuery, entry.path)
        if (onPath) return { entry, score: onPath.score, indices: [] }
        return null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)

    const results = scored.map(({ entry, indices }) => toItem(entry, indices))

    const exact = entries.some((e) => e.title.toLowerCase() === deferredQuery.trim().toLowerCase())
    if (!exact) {
      results.push({
        id: '__create__',
        label: `Create "${deferredQuery.trim()}"`,
        detail: 'New note',
        onSelect: () => void createNote('', deferredQuery.trim())
      })
    }
    return results
  }, [deferredQuery, queryIsStale, notes, history])

  return (
    <Picker
      placeholder="Go to a note…"
      items={items}
      query={query}
      onQueryChange={setQuery}
      onClose={close}
      emptyMessage="No notes match"
      footer={
        <>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </>
      }
    />
  )
}

function toItem(
  entry: { path: string; title: string },
  indices: number[] = []
): PickerItem {
  return {
    id: entry.path,
    label: entry.title,
    indices,
    detail: dirname(entry.path),
    onSelect: () => openNote(entry.path)
  }
}
