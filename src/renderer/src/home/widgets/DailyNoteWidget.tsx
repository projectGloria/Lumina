import { formatDate } from '@shared/template'
import { Icon } from '@/components/Icon'
import { dailyNotePath, openDailyNote } from '@/lib/actions'
import { useSettings } from '@/store/settingsStore'
import { useVault } from '@/store/vaultStore'
import { defineWidget } from './types'

function DailyNote(): React.JSX.Element {
  // Subscribed so the card follows a change to the daily-note folder or
  // format, even though the path itself comes from the shared helper.
  useSettings((s) => s.settings.dailyNotes)
  const index = useVault((s) => s.index)

  const path = dailyNotePath()
  const entry = index.notes[path]

  return (
    <div className="home-daily">
      <p className="home-daily-date">{formatDate('DDDD, DD MMMM')}</p>
      {entry ? (
        <p className="home-daily-excerpt">{entry.excerpt || 'This note is still empty.'}</p>
      ) : (
        <p className="home-widget-empty">No note for today yet.</p>
      )}
      <button className="btn btn-small home-daily-action" onClick={() => void openDailyNote()}>
        <Icon name={entry ? 'edit' : 'plus'} size={14} />
        <span>{entry ? 'Open today’s note' : 'Start today’s note'}</span>
      </button>
    </div>
  )
}

export const dailyWidget = defineWidget<Record<string, unknown>>({
  type: 'daily',
  name: 'Daily note',
  description: 'Today’s note, created from your template if it does not exist yet',
  icon: 'clock',
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 2 },
  defaultConfig: {},
  accent: 'time',
  Component: DailyNote
})
