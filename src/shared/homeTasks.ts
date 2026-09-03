/**
 * What the Home board's task list shows, and in what order.
 *
 * A checkbox on a board is not a checkbox in a note: ticking one writes the
 * file, the watcher notices, the note is reparsed and the index arrives again
 * a moment later with different contents *and* a different mtime. Everything
 * awkward about the list follows from that round trip, so the rules live here
 * as pure functions over rows and are pinned down in
 * `tests/home-tasks.test.ts` rather than being rediscovered in a component.
 */

/** One checkbox, as the index knows it plus the note it came from. */
export interface TaskRow {
  path: string
  line: number
  /** Raw markdown, the way the index stores it. */
  text: string
  done: boolean
  /** The note's mtime — what the list is ordered by. */
  mtime: number
}

/**
 * A box ticked here, from the click until the board stops holding it.
 *
 * One entry covers both halves of the round trip: `pending` is true until the
 * index agrees, and `at` dates the entry for both the hold and every timeout.
 */
export interface TaskTick {
  /** What the box was set to. */
  done: boolean
  at: number
  /** True until the index comes back agreeing with `done`. */
  pending: boolean
}

export type TaskTicks = Record<string, TaskTick>

/**
 * How long a task ticked here keeps its place on the board.
 *
 * A tick used to remove the row from the list on the same click, which reads
 * as "I clicked a checkbox and something was deleted". It stays instead — drawn
 * as done, struck through, still untickable — for long enough to notice and
 * undo. This also bounds every wait below: an entry the index never confirms
 * (the note was deleted, the line is gone) is dropped at the same deadline
 * rather than stranded for the rest of the session.
 */
export const TASK_HOLD_MS = 8000

/** `path:line` — a task has no id of its own, and the pair is what identifies it. */
export const taskKey = (path: string, line: number): string => `${path}:${line}`

/**
 * The path and line a key names.
 *
 * Split on the *last* colon, which is sound for every path a vault can hold:
 * the line number is digits, so the colon this appends is always the last one
 * in the string, even for a note called `Chapter: One.md`.
 */
export function parseTaskKey(key: string): { path: string; line: number } | null {
  const split = key.lastIndexOf(':')
  if (split <= 0) return null
  // Tested against the digits rather than with `Number`, which reads the empty
  // string in `Notes/Todo.md:` as line zero.
  const tail = key.slice(split + 1)
  if (!/^\d+$/.test(tail)) return null
  return { path: key.slice(0, split), line: Number(tail) }
}

/** Record a click, optimistically, before the write has been made. */
export function tick(ticks: TaskTicks, key: string, done: boolean, now: number): TaskTicks {
  return { ...ticks, [key]: { done, at: now, pending: true } }
}

/** Forget a click — the write failed, or the row was unticked. */
export function drop(ticks: TaskTicks, key: string): TaskTicks {
  if (!(key in ticks)) return ticks
  const next = { ...ticks }
  delete next[key]
  return next
}

/**
 * Settle what the index now agrees with, and expire the rest.
 *
 * `rows` must be every task in scope, not the filtered list — a finished task
 * hidden by `showDone` is still the proof that a tick landed.
 */
export function reconcileTicks(
  ticks: TaskTicks,
  rows: TaskRow[],
  now: number,
  hold = TASK_HOLD_MS
): { next: TaskTicks; changed: boolean } {
  const byKey = new Map(rows.map((row) => [taskKey(row.path, row.line), row]))
  const next: TaskTicks = {}
  let changed = false

  for (const [key, entry] of Object.entries(ticks)) {
    // Past the deadline every entry goes, whatever it is waiting for. This is
    // the only thing standing between a deleted note and an entry that never
    // settles, so it must not be conditional on the row still existing.
    if (now - entry.at >= hold) {
      changed = true
      continue
    }

    const row = byKey.get(key)
    if (entry.pending && row && row.done === entry.done) {
      // An untick needs no hold: the row is visible on its own merits again.
      if (!entry.done) {
        changed = true
        continue
      }
      next[key] = { ...entry, pending: false }
      changed = true
      continue
    }
    next[key] = entry
  }

  return { next: changed ? next : ticks, changed }
}

export interface TaskViewOptions {
  showDone: boolean
  ticks: TaskTicks
  /**
   * The key order to keep, or null to order by mtime.
   *
   * Writing a tick rewrites the note, which bumps its mtime and would reorder
   * the whole list under the pointer that just clicked it.
   */
  frozen: string[] | null
  limit: number
}

export interface TaskViewRow extends TaskRow {
  key: string
  /** Held by this board: ticked here moments ago, and still undoable. */
  held: boolean
}

const natural = (a: TaskViewRow, b: TaskViewRow): number =>
  b.mtime - a.mtime || a.path.localeCompare(b.path) || a.line - b.line

/** The rows to draw, in the order to draw them. */
export function taskView(rows: TaskRow[], options: TaskViewOptions): TaskViewRow[] {
  const { showDone, ticks, frozen, limit } = options

  const view: TaskViewRow[] = []
  for (const row of rows) {
    if (!row.text) continue
    const key = taskKey(row.path, row.line)
    const entry = ticks[key]
    // The optimistic value while a write is in flight, the file's own once the
    // index has caught up.
    const done = entry?.pending ? entry.done : row.done
    const held = !!entry && entry.done
    if (!showDone && done && !held) continue
    view.push({ ...row, key, done, held })
  }

  view.sort(natural)
  if (frozen) {
    const rank = new Map(frozen.map((key, i) => [key, i]))
    // A row the freeze never saw sorts after every row it did, keeping its
    // natural place among the other newcomers.
    view.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity))
  }

  return view.slice(0, Math.max(1, Math.round(limit) || 1))
}

/**
 * The order to hold onto while ticks settle.
 *
 * Captured from what is on screen at the moment of the first click and released
 * once nothing is outstanding, so the list is only ever frozen while something
 * would otherwise be moving.
 */
export function nextFrozenOrder(
  current: string[] | null,
  view: TaskViewRow[],
  ticks: TaskTicks
): string[] | null {
  if (!Object.keys(ticks).length) return null
  return current ?? view.map((row) => row.key)
}

/** When the earliest outstanding entry expires, or null if there are none. */
export function nextTickDeadline(ticks: TaskTicks, hold = TASK_HOLD_MS): number | null {
  const times = Object.values(ticks).map((entry) => entry.at + hold)
  return times.length ? Math.min(...times) : null
}
