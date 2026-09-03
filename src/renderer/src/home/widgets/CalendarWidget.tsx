import { useMemo, useState } from 'react'
import { oneOf } from '@shared/homeConfig'
import { dayKey } from '@shared/homeDates'
import { formatDate } from '@shared/template'
import { Icon } from '@/components/Icon'
import { dailyNotePath, ensureNote, openDailyNote, openNote } from '@/lib/actions'
import { useSettings } from '@/store/settingsStore'
import { useVault } from '@/store/vaultStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface CalendarConfig extends Record<string, unknown> {
  weekStart: 'monday' | 'sunday'
}

const sameDay = (a: Date, b: Date): boolean => dayKey(a) === dayKey(b)

function Calendar({ config }: WidgetProps<CalendarConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)
  // Subscribed so the dots follow a change to the daily-note folder or format,
  // which the path helper reads from the store itself.
  const daily = useSettings((s) => s.settings.dailyNotes)
  const [monthOffset, setMonthOffset] = useState(0)
  // A string default cannot say which strings mean something, so the one fixed
  // set of words this widget accepts is checked here.
  const weekStart = oneOf(config.weekStart, ['monday', 'sunday'] as const, 'monday')

  const today = new Date()
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)

  /** How many notes were written on each day, for the shading behind the date. */
  const created = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of Object.values(index.notes)) {
      if (!note.createdAt) continue
      const key = dayKey(new Date(note.createdAt))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [index])

  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const lead = weekStart === 'monday' ? (first.getDay() + 6) % 7 : first.getDay()
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const rows = Math.ceil((lead + days) / 7)

    const start = new Date(first)
    start.setDate(first.getDate() - lead)
    return Array.from({ length: rows }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => {
        const date = new Date(start)
        date.setDate(start.getDate() + week * 7 + day)
        return date
      })
    )
  }, [month, weekStart])

  const labels =
    weekStart === 'monday'
      ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      : ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  const open = (date: Date): void => {
    // Today goes through the command, so the daily-note template is applied;
    // an older day just gets its note with a heading.
    if (sameDay(date, today)) {
      void openDailyNote()
      return
    }
    void (async () => {
      const name = formatDate(daily.format || 'YYYY-MM-DD', date)
      const path = await ensureNote(dailyNotePath(date), `# ${name}\n\n`)
      if (path) openNote(path)
    })()
  }

  return (
    <div className="home-calendar">
      <div className="home-calendar-head">
        <button
          className="icon-btn"
          aria-label="Previous month"
          data-tooltip="Previous month"
          onClick={() => setMonthOffset((m) => m - 1)}
        >
          <Icon name="back" size={14} />
        </button>
        <button
          className="home-calendar-month"
          data-tooltip="Back to this month"
          onClick={() => setMonthOffset(0)}
        >
          {formatDate('MMMM YYYY', month)}
        </button>
        <button
          className="icon-btn"
          aria-label="Next month"
          data-tooltip="Next month"
          onClick={() => setMonthOffset((m) => m + 1)}
        >
          <Icon name="forward" size={14} />
        </button>
      </div>

      <div className="home-calendar-grid">
        {labels.map((label, i) => (
          <div key={`${label}-${i}`} className="home-calendar-label">
            {label}
          </div>
        ))}

        {weeks.flat().map((date) => {
          const outside = date.getMonth() !== month.getMonth()
          const hasNote = !!index.notes[dailyNotePath(date)]
          const written = created.get(dayKey(date)) ?? 0
          return (
            <button
              key={date.toISOString()}
              className={[
                'home-calendar-day',
                outside ? 'is-outside' : '',
                sameDay(date, today) ? 'is-today' : '',
                written ? 'has-notes' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              data-tooltip={
                written
                  ? `${formatDate('DDDD DD MMMM', date)} · ${written} note${written === 1 ? '' : 's'} written`
                  : formatDate('DDDD DD MMMM', date)
              }
              onClick={() => open(date)}
            >
              <span>{date.getDate()}</span>
              {hasNote ? <span className="home-calendar-dot" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CalendarSettings({
  config,
  setConfig
}: WidgetSettingsProps<CalendarConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>Week starts</span>
      <select
        value={oneOf(config.weekStart, ['monday', 'sunday'] as const, 'monday')}
        onChange={(e) => setConfig({ weekStart: e.target.value as CalendarConfig['weekStart'] })}
      >
        <option value="monday">Monday</option>
        <option value="sunday">Sunday</option>
      </select>
    </label>
  )
}

export const calendarWidget = defineWidget<CalendarConfig>({
  type: 'calendar',
  name: 'Calendar',
  description: 'The month, with a dot on every day that has a note',
  icon: 'clock',
  defaultSize: { w: 2, h: 3 },
  minSize: { w: 2, h: 2 },
  defaultConfig: { weekStart: 'monday' },
  accent: 'time',
  Component: Calendar,
  Settings: CalendarSettings
})
