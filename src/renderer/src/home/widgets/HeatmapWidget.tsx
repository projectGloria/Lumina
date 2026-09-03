import { useMemo } from 'react'
import { formatDate } from '@shared/template'
import { useVault } from '@/store/vaultStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface HeatmapConfig extends Record<string, unknown> {
  weeks: number
}

const DAY = 86_400_000

/** Five steps, because more than that reads as noise at this cell size. */
function level(count: number): number {
  if (!count) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  return 4
}

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/**
 * Notes touched per day, as a grid of weeks.
 *
 * Measured on `mtime` rather than `createdAt`: the question a board answers is
 * "have I been writing", and editing an old note is writing.
 */
function Heatmap({ config }: WidgetProps<HeatmapConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)
  const weeks = Math.min(Math.max(Math.round(config.weeks), 4), 53)

  const columns = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of Object.values(index.notes)) {
      if (!note.mtime) continue
      const key = dayKey(new Date(note.mtime))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    // End on the Saturday of this week so the last column is the current one.
    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    end.setDate(end.getDate() + (6 - end.getDay()))

    return Array.from({ length: weeks }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => {
        const date = new Date(end.getTime() - ((weeks - 1 - week) * 7 + (6 - day)) * DAY)
        const count = counts.get(dayKey(date)) ?? 0
        return { date, count, ahead: date.getTime() > today.getTime() }
      })
    )
  }, [index, weeks])

  return (
    <div className="home-heatmap">
      <div className="home-heatmap-grid" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {columns.map((column, i) => (
          <div key={i} className="home-heatmap-week">
            {column.map(({ date, count, ahead }) => (
              <span
                key={date.toISOString()}
                className={`home-heatmap-cell${ahead ? ' is-ahead' : ''}`}
                data-level={level(count)}
                data-tooltip={`${formatDate('DDD DD MMM', date)} · ${count} note${count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="home-heatmap-legend">
        <span>Quieter</span>
        {[0, 1, 2, 3, 4].map((step) => (
          <span key={step} className="home-heatmap-cell" data-level={step} />
        ))}
        <span>Busier</span>
      </div>
    </div>
  )
}

function HeatmapSettings({
  config,
  setConfig
}: WidgetSettingsProps<HeatmapConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>Weeks shown</span>
      <input
        type="number"
        min={4}
        max={53}
        value={config.weeks}
        onChange={(e) => setConfig({ weeks: Number(e.target.value) || 4 })}
      />
    </label>
  )
}

export const heatmapWidget = defineWidget<HeatmapConfig>({
  type: 'heatmap',
  name: 'Activity',
  description: 'How much you wrote each day, as a grid of weeks',
  icon: 'grid',
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 2, h: 1 },
  defaultConfig: { weeks: 26 },
  Component: Heatmap,
  Settings: HeatmapSettings
})
