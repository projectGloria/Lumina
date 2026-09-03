/**
 * The Home board's geometry.
 *
 * Every rule about where a widget may sit lives here, as pure functions over
 * grid units, so `tests/home-layout.test.ts` can pin the behaviour down in
 * vitest's node environment and the renderer is left with nothing to do but
 * draw. Coordinates are columns and rows, never pixels — the board picks a
 * column count from its own width and the same layout has to read at four
 * columns and at one.
 */
import type { HomeCover, HomeLayout, HomeWidget } from './types'
import { HOME_LAYOUT_VERSION } from './types'

export interface GridRect {
  x: number
  y: number
  w: number
  h: number
}

export interface GridSize {
  w: number
  h: number
}

/** Widest board anyone can author, so a hand-edited `columns` cannot explode the grid. */
export const MAX_COLUMNS = 12

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

const byPosition = (a: GridRect, b: GridRect): number => a.y - b.y || a.x - b.x

/**
 * Bring a widget inside the board: whole cells, at least its minimum size, no
 * wider than the board and never hanging off the right edge.
 */
export function clampToColumns(
  widget: HomeWidget,
  columns: number,
  min: GridSize = { w: 1, h: 1 }
): HomeWidget {
  const cols = Math.max(1, Math.round(columns))
  const w = Math.min(Math.max(Math.round(widget.w), Math.max(1, min.w)), cols)
  const h = Math.max(Math.round(widget.h), Math.max(1, min.h))
  const x = Math.min(Math.max(Math.round(widget.x), 0), cols - w)
  const y = Math.max(Math.round(widget.y), 0)
  if (widget.x === x && widget.y === y && widget.w === w && widget.h === h) return widget
  return { ...widget, x, y, w, h }
}

/**
 * Settle the board: no widget overlaps another, and each floats as far up as
 * it can go.
 *
 * Vertical compaction is what keeps a board tidy after a removal — the hole a
 * deleted widget leaves closes on its own rather than staying as dead space.
 */
export function compact(widgets: HomeWidget[], columns: number): HomeWidget[] {
  const ordered = widgets.map((w) => clampToColumns(w, columns)).sort(byPosition)
  const placed: HomeWidget[] = []

  for (const widget of ordered) {
    const collides = (y: number): boolean =>
      placed.some((other) => rectsOverlap({ ...widget, y }, other))

    let y = widget.y
    while (collides(y)) y++
    // Only then float up, so a widget pushed down past a gap still finds it.
    while (y > 0 && !collides(y - 1)) y--
    placed.push(y === widget.y ? widget : { ...widget, y })
  }

  return placed
}

/**
 * Put one widget where the pointer left it, and let the board absorb it.
 *
 * Anything it lands on is pushed below it before the compaction pass, which is
 * what makes a drop feel like an insertion rather than a swap; the moved
 * widget wins the contested cells because it is placed first.
 */
export function placeWidget(
  widgets: HomeWidget[],
  target: HomeWidget,
  columns: number,
  min: GridSize = { w: 1, h: 1 }
): HomeWidget[] {
  const moved = clampToColumns(target, columns, min)
  const displaced = widgets
    .filter((widget) => widget.id !== moved.id)
    .map((widget) => (rectsOverlap(widget, moved) ? { ...widget, y: moved.y + moved.h } : widget))

  return compact([moved, ...displaced], columns)
}

/** The first cell a widget of this size fits in, scanning left to right, top down. */
export function findFreeSpot(
  widgets: HomeWidget[],
  size: GridSize,
  columns: number
): { x: number; y: number } {
  const cols = Math.max(1, Math.round(columns))
  const w = Math.min(Math.max(1, size.w), cols)
  const h = Math.max(1, size.h)
  const bottom = widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0)

  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (!widgets.some((widget) => rectsOverlap({ x, y, w, h }, widget))) return { x, y }
    }
  }
  // Every row up to the last widget's bottom edge is taken, so the row after
  // it is free by definition.
  return { x: 0, y: bottom }
}

/** Redraw a layout at a different width, without re-authoring the stored one. */
export function fitToColumns(widgets: HomeWidget[], columns: number): HomeWidget[] {
  return compact(widgets, columns)
}

function validWidget(value: unknown): HomeWidget | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.type !== 'string' || !raw.type) return null

  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback

  return {
    id: raw.id,
    type: raw.type,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.w, 1),
    h: num(raw.h, 1),
    config:
      raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
        ? (raw.config as Record<string, unknown>)
        : {}
  }
}

function validCover(value: unknown): HomeCover | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.path !== 'string' || !raw.path) return null

  const position =
    typeof raw.position === 'number' && Number.isFinite(raw.position)
      ? Math.min(Math.max(Math.round(raw.position), 0), 100)
      : 50
  return { path: raw.path, position }
}

/**
 * Make sense of whatever is in `home.json`.
 *
 * The file is a plain JSON document a user may well have edited by hand, so
 * nothing here trusts it: coordinates are clamped, overlaps are resolved and
 * unusable entries are dropped. A widget whose `type` the registry no longer
 * knows is *kept* — the board draws a placeholder for it rather than quietly
 * deleting something the user arranged, which is what would happen if a
 * renamed widget shipped without a migration.
 */
export function normalizeLayout(value: unknown): HomeLayout {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const columns =
    typeof raw.columns === 'number' && Number.isFinite(raw.columns)
      ? Math.min(Math.max(Math.round(raw.columns), 1), MAX_COLUMNS)
      : 4

  const seen = new Set<string>()
  const widgets: HomeWidget[] = []
  for (const entry of Array.isArray(raw.widgets) ? raw.widgets : []) {
    const widget = validWidget(entry)
    // A duplicated id would make two cards share one React key and one drag.
    if (!widget || seen.has(widget.id)) continue
    seen.add(widget.id)
    widgets.push(widget)
  }

  const cover = validCover(raw.cover)
  return {
    version: HOME_LAYOUT_VERSION,
    columns,
    widgets: compact(widgets, columns),
    // Omitted rather than stored as undefined, so a board with no cover reads
    // as one in the file too.
    ...(cover ? { cover } : {})
  }
}
