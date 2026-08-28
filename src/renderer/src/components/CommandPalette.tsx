import { useMemo, useState } from 'react'
import Picker, { type PickerItem } from './Picker'
import { COMMANDS, hotkeyFor } from '../lib/commands'
import { fuzzyMatch } from '../lib/fuzzy'
import { acceleratorChips } from '../lib/hotkeys'
import { useUi } from '../store/uiStore'

export default function CommandPalette(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const close = useUi((s) => s.closeModal)

  const items = useMemo<PickerItem[]>(() => {
    const available = COMMANDS.filter((c) => !c.enabled || c.enabled())

    if (!query.trim()) {
      return available.map((command) => ({
        id: command.id,
        label: command.title,
        section: command.section,
        hint: acceleratorChips(hotkeyFor(command)),
        onSelect: command.run
      }))
    }

    return available
      .map((command) => {
        const match = fuzzyMatch(query, command.title)
        return match ? { command, match } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.match.score - a.match.score)
      .map(({ command, match }) => ({
        id: command.id,
        label: command.title,
        indices: match.indices,
        detail: command.section,
        hint: acceleratorChips(hotkeyFor(command)),
        onSelect: command.run
      }))
  }, [query])

  return (
    <Picker
      placeholder="Run a command…"
      items={items}
      query={query}
      onQueryChange={setQuery}
      onClose={close}
      emptyMessage="No command matches"
    />
  )
}
