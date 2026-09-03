/**
 * The board a vault gets before anyone has arranged one.
 *
 * A first run opens on something worth looking at rather than an empty page,
 * and this is the only place that decides what that is. It is seeded once and
 * written straight to `home.json`, so the ids it generates are the ones the
 * board keeps.
 */
import type { HomeLayout, HomeWidget } from '@shared/types'
import { HOME_LAYOUT_VERSION } from '@shared/types'
import { compact } from '@shared/homeLayout'
import { widgetDef } from './index'

/** The starter board is authored four columns wide; narrower windows refold it. */
const SEED_COLUMNS = 4

/** `[type, x, y, w, h]`, in the reading order a new vault should get. */
const SEED: [string, number, number, number, number][] = [
  ['capture', 0, 0, 2, 2],
  ['daily', 2, 0, 1, 2],
  ['progress', 3, 0, 1, 2],
  ['graph', 0, 2, 2, 3],
  ['tasks', 2, 2, 2, 3],
  ['calendar', 0, 5, 2, 3],
  ['recent', 2, 5, 2, 3],
  ['heatmap', 0, 8, 4, 2],
  ['tags', 0, 10, 2, 2],
  ['stats', 2, 10, 2, 1]
]

export function defaultLayout(): HomeLayout {
  const widgets: HomeWidget[] = SEED
    // A seed naming a widget this build dropped would ship as an "unknown
    // widget" card on every new vault, which is worse than one fewer card.
    .filter(([type]) => !!widgetDef(type))
    .map(([type, x, y, w, h]) => ({
      id: crypto.randomUUID(),
      type,
      x,
      y,
      w,
      h,
      config: {}
    }))

  return {
    version: HOME_LAYOUT_VERSION,
    columns: SEED_COLUMNS,
    widgets: compact(widgets, SEED_COLUMNS)
  }
}
