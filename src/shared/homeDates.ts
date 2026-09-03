/**
 * The board's calendar arithmetic.
 *
 * Every widget that buckets notes by day needs the same two things: a key that
 * two timestamps on one local day agree on, and a way to step from one day to
 * the next. The second is the one that goes wrong. A day is not 86,400,000ms —
 * on the night the clocks go forward it is an hour shorter, so subtracting
 * fixed milliseconds from a local midnight lands at 23:00 the day before and
 * the day that follows it is dropped from the grid entirely, with every day
 * around it shifted by one. `Date.setDate` moves by the calendar and has no
 * such hole, which is why it is the only stepping used here.
 */

/** Local year-month-day, ignoring the time — two notes on one day share a key. */
export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** Local midnight on the day `date` falls in. */
export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** `days` after `date` (or before, if negative), by the calendar. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/**
 * The grid an activity heatmap draws: `weeks` columns of seven days, oldest
 * first, each column running Sunday to Saturday.
 *
 * It ends on the Saturday of `today`'s own week, so the last column is the
 * current one and the days after today are there to be drawn as still to come.
 */
export function heatmapDays(today: Date, weeks: number): Date[][] {
  const span = Math.max(1, Math.round(weeks) || 1)
  const end = addDays(startOfDay(today), 6 - today.getDay())
  const start = addDays(end, -(span * 7 - 1))
  return Array.from({ length: span }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day))
  )
}
