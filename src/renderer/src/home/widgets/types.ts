/**
 * What a Home widget is.
 *
 * Widgets are data in the same way commands are: a definition here, one entry
 * in the registry, and the board can draw it. Adding a widget must never mean
 * editing the board, the store, or the persistence layer.
 */
import type { WidgetPathHooks } from '@shared/homePaths'
import type { IconName } from '@/components/Icon'

export interface WidgetProps<C = unknown> {
  /** The widget instance's id, stable across moves. */
  id: string
  /** Stored options merged over the definition's `defaultConfig`. */
  config: C
  /** Persist a change to this instance's options. */
  setConfig: (patch: Partial<C>) => void
}

export interface WidgetSettingsProps<C = unknown> {
  config: C
  setConfig: (patch: Partial<C>) => void
}

export interface GridSpan {
  w: number
  h: number
}

/**
 * Which decorative colour a card's icon chip is tinted with.
 *
 * The names describe what the *board* groups, not what a colour means
 * elsewhere in the app — these map to `--lum-widget-accent-1..5`, which exist
 * precisely so a chip never borrows `--lum-warning` and leaves two cards
 * looking like they are in an error state under someone's theme. Nothing here
 * carries status; a widget that has nothing to say picks `quiet`.
 */
export type WidgetAccent = 'primary' | 'progress' | 'time' | 'keep' | 'quiet'

/**
 * `WidgetPathHooks` is part of a definition because a widget that stores a
 * vault path is data about that too: `lib/actions.ts` walks the board through
 * these on a rename, a move and a delete, so nothing has to be taught about
 * the widget one by one. Declaring one is the whole of what a new widget owes
 * — see the list in CLAUDE.md.
 */
export interface WidgetDef<C = unknown> extends WidgetPathHooks {
  /** Stable id, written into `home.json`. Renaming one orphans every board. */
  type: string
  /** Shown in the picker and as the card's title. */
  name: string
  description: string
  /** Must exist in `components/Icon.tsx`. */
  icon: IconName
  defaultSize: GridSpan
  /** The board refuses to draw or store anything smaller. */
  minSize: GridSpan
  defaultConfig: C
  /** The card's chip tint. Defaults to `primary` when a widget says nothing. */
  accent?: WidgetAccent
  Component: React.ComponentType<WidgetProps<C>>
  /** Per-widget options, shown in the card's overflow menu. */
  Settings?: React.ComponentType<WidgetSettingsProps<C>>
}

/**
 * A definition with its config type erased.
 *
 * The registry holds widgets that disagree about what `config` is, and a
 * component's props are contravariant, so no single parameterised type covers
 * them. Each definition is still checked against its own config on the way in.
 */
export type AnyWidgetDef = WidgetDef<any>

export function defineWidget<C extends Record<string, unknown>>(def: WidgetDef<C>): AnyWidgetDef {
  return def as AnyWidgetDef
}
