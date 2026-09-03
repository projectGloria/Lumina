import { useMemo } from 'react'
import { addDays, dayKey, startOfDay } from '@shared/homeDates'
import { sparkShape } from '@shared/homeSpark'
import { useVault } from '@/store/vaultStore'
import { defineWidget } from './types'

/** How far back the line goes. A fortnight is a shape; a week is a zigzag. */
const SPARK_DAYS = 14

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

  /** Notes touched per day, most recent last — the same measure the grid uses. */
  const spark = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of Object.values(index.notes)) {
      if (!note.mtime) continue
      const key = dayKey(new Date(note.mtime))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const today = startOfDay(new Date())
    return sparkShape(
      Array.from({ length: SPARK_DAYS }, (_, i) =>
        counts.get(dayKey(addDays(today, i - (SPARK_DAYS - 1)))) ?? 0
      )
    )
  }, [index])

  return (
    <div className="home-stats-card">
      <dl className="home-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="home-stat">
            <dt className="home-stat-value">{stat.value.toLocaleString()}</dt>
            <dd className="home-stat-label">{stat.label}</dd>
          </div>
        ))}
      </dl>
      {spark ? (
        <svg
          className="home-spark"
          viewBox={`0 0 ${spark.width} ${spark.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Notes touched over the last ${SPARK_DAYS} days`}
        >
          <polygon className="home-spark-area" points={spark.area} />
          <polyline className="home-spark-line" points={spark.line} />
        </svg>
      ) : null}
    </div>
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
  accent: 'quiet',
  Component: Stats
})
