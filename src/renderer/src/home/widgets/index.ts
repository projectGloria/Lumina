/**
 * Every Home widget, in one registry.
 *
 * Adding a widget means adding one entry here and nothing else: the picker,
 * the board and `home.json` all read this list. A `type` is persisted, so
 * renaming one orphans every board that used it — add a new entry instead.
 */
import { registerWidgetPathHooks } from '@/lib/actions'
import { calendarWidget } from './CalendarWidget'
import { captureWidget } from './CaptureWidget'
import { clockWidget } from './ClockWidget'
import { dailyWidget } from './DailyNoteWidget'
import { graphWidget } from './GraphWidget'
import { heatmapWidget } from './HeatmapWidget'
import { onThisDayWidget } from './OnThisDayWidget'
import { pinnedWidget, starredWidget } from './PathListWidget'
import { progressWidget } from './ProgressWidget'
import { recentWidget } from './RecentWidget'
import { scratchWidget } from './ScratchWidget'
import { statsWidget } from './StatsWidget'
import { tasksWidget } from './TasksWidget'
import { tagsWidget } from './TagsWidget'
import type { AnyWidgetDef } from './types'

export type { AnyWidgetDef, WidgetDef, WidgetProps, WidgetSettingsProps } from './types'

/** Listed in the order the picker offers them: capture first, chrome last. */
export const WIDGETS: AnyWidgetDef[] = [
  captureWidget,
  tasksWidget,
  progressWidget,
  dailyWidget,
  calendarWidget,
  scratchWidget,
  graphWidget,
  heatmapWidget,
  recentWidget,
  starredWidget,
  pinnedWidget,
  tagsWidget,
  onThisDayWidget,
  statsWidget,
  clockWidget
]

const BY_TYPE = new Map(WIDGETS.map((def) => [def.type, def]))

/**
 * The definition for a stored widget, or undefined when this build no longer
 * knows the type. The board draws a placeholder for that case rather than
 * dropping it from the layout.
 */
export function widgetDef(type: string): AnyWidgetDef | undefined {
  return BY_TYPE.get(type)
}

/**
 * Hand `lib/actions.ts` the lookup it needs to move the vault paths widgets
 * store when a note or folder is renamed, moved or deleted.
 *
 * Published from here rather than imported there: `actions.ts` imports only
 * shared code and stores, and every widget in this registry imports it, so an
 * import the other way would be a cycle. This module is evaluated at boot —
 * `App.tsx` reaches it through the starter board — so the lookup is in place
 * long before anything can be renamed.
 */
registerWidgetPathHooks(widgetDef)
