import { useMemo, useState } from 'react'
import Picker, { type PickerItem } from './Picker'
import { Icon } from './Icon'
import { COMMANDS, hotkeyFor } from '../lib/commands'
import { fuzzyMatch } from '../lib/fuzzy'
import { acceleratorChips } from '../lib/hotkeys'
import { useSettings } from '../store/settingsStore'
import { useUi } from '../store/uiStore'

export default function CommandPalette(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const close = useUi((s) => s.closeModal)
  const hotkeys = useSettings((s) => s.settings.hotkeys)

  const items = useMemo<PickerItem[]>(() => {
    const available = COMMANDS.filter((c) => !c.enabled || c.enabled())

    if (!query.trim()) {
      return available.map((command) => ({
        id: command.id,
        label: command.title,
        icon: <Icon name={command.icon ?? 'bolt'} size={15} />,
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
        icon: <Icon name={command.icon ?? 'bolt'} size={15} />,
        indices: match.indices,
        detail: command.section,
        hint: acceleratorChips(hotkeyFor(command)),
        onSelect: command.run
      }))
  }, [query, hotkeys])

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
