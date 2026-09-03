import { useMemo } from 'react'
import PathIcon from '@/components/PathIcon'
import { openNote, promptNewNote } from '@/lib/actions'
import { useVault } from '@/store/vaultStore'
import { EmptyCard, LoadingCard } from './CardState'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'
import { timeAgo } from './util'

interface RecentConfig extends Record<string, unknown> {
  count: number
}

function Recent({ config }: WidgetProps<RecentConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)
  const loading = useVault((s) => s.loading)
  const notes = useMemo(
    () =>
      Object.values(index.notes)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, Math.max(1, config.count)),
    [index, config.count]
  )

  if (!notes.length) {
    if (loading) return <LoadingCard rows={3} />
    return (
      <EmptyCard
        icon="file"
        line="Nothing written yet."
        action={{ label: 'New note', icon: 'plus', onSelect: () => promptNewNote() }}
      />
    )
  }

  return (
    <ul className="home-list">
      {notes.map((note) => (
        <li key={note.path}>
          <button className="home-row" onClick={() => openNote(note.path)} data-tooltip={note.path}>
            <PathIcon path={note.path} size={15} className="home-row-icon" />
            <span className="home-row-label truncate">{note.title}</span>
            <span className="home-row-meta">{timeAgo(note.mtime)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function RecentSettings({ config, setConfig }: WidgetSettingsProps<RecentConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>Notes shown</span>
      <input
        type="number"
        min={1}
        max={20}
        value={config.count}
        onChange={(e) => setConfig({ count: Number(e.target.value) || 1 })}
      />
    </label>
  )
}

export const recentWidget = defineWidget<RecentConfig>({
  type: 'recent',
  name: 'Recent notes',
  description: 'The notes you touched most recently',
  icon: 'clock',
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  defaultConfig: { count: 6 },
  accent: 'quiet',
  Component: Recent,
  Settings: RecentSettings
})
