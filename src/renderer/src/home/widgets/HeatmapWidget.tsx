import { useMemo } from 'react'
import { dayKey, heatmapDays } from '@shared/homeDates'
import { heatLevel, heatThresholds } from '@shared/homeHeat'
import { formatDate } from '@shared/template'
import { useVault } from '@/store/vaultStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface HeatmapConfig extends Record<string, unknown> {
  weeks: number
}

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

    // Stepped by the calendar in `heatmapDays`, not by fixed milliseconds: a
    // day is an hour shorter when the clocks go forward, and the old ms
    // arithmetic dropped that day from the grid altogether.
    const now = Date.now()
    const grid = heatmapDays(new Date(now), weeks).map((column) =>
      column.map((date) => ({
        date,
        count: counts.get(dayKey(date)) ?? 0,
        ahead: date.getTime() > now
      }))
    )

    // Shaded against the days on screen rather than against fixed counts, so
    // the grid has a shape whether this vault writes two notes a day or forty.
    const thresholds = heatThresholds(grid.flat().map((cell) => cell.count))
    return grid.map((column) =>
      column.map((cell) => ({ ...cell, level: heatLevel(cell.count, thresholds) }))
    )
  }, [index, weeks])

  return (
    <div className="home-heatmap">
      <div className="home-heatmap-grid" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {columns.map((column, i) => (
          <div key={i} className="home-heatmap-week">
            {column.map(({ date, count, ahead, level }) => (
              <span
                key={date.toISOString()}
                className={`home-heatmap-cell${ahead ? ' is-ahead' : ''}`}
                data-level={level}
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
