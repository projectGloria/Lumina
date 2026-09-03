import { useMemo } from 'react'
import { useVault } from '@/store/vaultStore'
import { defineWidget } from './types'

function Stats(): React.JSX.Element {
  const index = useVault((s) => s.index)

  const stats = useMemo(() => {
    const notes = Object.values(index.notes)
    return [
      { label: notes.length === 1 ? 'note' : 'notes', value: notes.length },
      { label: 'words', value: notes.reduce((sum, note) => sum + note.wordCount, 0) },
      { label: 'tags', value: Object.keys(index.tags).length },
      { label: 'broken links', value: index.unresolved.length }
    ]
  }, [index])

  return (
    <dl className="home-stats">
      {stats.map((stat) => (
        <div key={stat.label} className="home-stat">
          <dt className="home-stat-value">{stat.value.toLocaleString()}</dt>
          <dd className="home-stat-label">{stat.label}</dd>
        </div>
      ))}
    </dl>
  )
}

export const statsWidget = defineWidget<Record<string, unknown>>({
  type: 'stats',
  name: 'Vault stats',
  description: 'Notes, words, tags, and links that go nowhere',
  icon: 'info',
  defaultSize: { w: 2, h: 1 },
  minSize: { w: 1, h: 1 },
  defaultConfig: {},
  Component: Stats
})
