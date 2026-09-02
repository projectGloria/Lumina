import { useDeferredValue, useMemo, useState } from 'react'
import Picker, { type PickerItem } from './Picker'
import { Icon } from './Icon'
import PathIcon from './PathIcon'
import { createNote, openNote } from '../lib/actions'
import { COMMANDS, hotkeyFor } from '../lib/commands'
import { fuzzyMatch } from '../lib/fuzzy'
import { acceleratorChips } from '../lib/hotkeys'
import { dirname } from '@shared/markdown-parse'
import { useSettings } from '../store/settingsStore'
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
  const hotkeys = useSettings((s) => s.settings.hotkeys)

  const items = useMemo<PickerItem[]>(() => {
    // Never let Enter choose a result calculated for the previous query.
    if (queryIsStale) return []
    const entries = Object.values(notes)
    const commands = COMMANDS.filter(
      (command) => command.id !== 'switcher.open' && (!command.enabled || command.enabled())
    )

    if (!deferredQuery.trim()) {
      // With no query, offer where you have actually been, most recent first.
      const recent = [...new Set([...history].reverse())].filter((p) => notes[p]).slice(0, 12)
      const rest = entries
        .filter((e) => !recent.includes(e.path))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)
      return [
        ...recent.map((p) => toNoteItem(notes[p], [], 'Recent notes')),
        ...rest.map((entry) => toNoteItem(entry, [], 'Notes')),
        ...commands.map((command) => toCommandItem(command))
      ]
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

    const results = scored.map(({ entry, indices }) => toNoteItem(entry, indices, 'Notes'))

    const commandResults = commands
      .map((command) => {
        const titleMatch = fuzzyMatch(deferredQuery, command.title)
        const keywordMatch = (command.keywords ?? [])
          .map((keyword) => fuzzyMatch(deferredQuery, keyword))
          .filter((match): match is NonNullable<typeof match> => match !== null)
          .sort((a, b) => b.score - a.score)[0]
        const match = titleMatch ?? keywordMatch
        return match
          ? { command, score: match.score, indices: titleMatch?.indices ?? [] }
          : null
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.score - a.score)
      .map(({ command, indices }) => toCommandItem(command, indices))

    const exact = entries.some((e) => e.title.toLowerCase() === deferredQuery.trim().toLowerCase())
    const createItems: PickerItem[] = exact
      ? []
      : [
          {
            id: '__create__',
            label: `Create "${deferredQuery.trim()}"`,
            icon: <Icon name="plus" size={15} />,
            detail: 'New note',
            section: 'Notes',
            onSelect: () => void createNote('', deferredQuery.trim())
          }
        ]
    return [...results, ...commandResults, ...createItems]
  }, [deferredQuery, queryIsStale, notes, history, hotkeys])

  return (
    <Picker
      placeholder="Go to a note or feature…"
      items={items}
      query={query}
      onQueryChange={setQuery}
      onClose={close}
      emptyMessage="No note or feature matches"
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

function toNoteItem(
  entry: { path: string; title: string },
  indices: number[] = [],
  section = 'Notes'
): PickerItem {
  return {
    id: entry.path,
    label: entry.title,
    icon: <PathIcon path={entry.path} size={15} />,
    indices,
    detail: dirname(entry.path),
    section,
    onSelect: () => openNote(entry.path)
  }
}

function toCommandItem(command: (typeof COMMANDS)[number], indices: number[] = []): PickerItem {
  return {
    id: `command.${command.id}`,
    label: command.title,
    icon: <Icon name={command.icon ?? 'bolt'} size={15} />,
    indices,
    detail: command.description ?? command.section,
    hint: acceleratorChips(hotkeyFor(command)),
    section: 'Features',
    onSelect: command.run
  }
}
