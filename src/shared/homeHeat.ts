/**
 * How busy a day has to be to earn each shade of the activity grid.
 *
 * Fixed thresholds do not survive contact with a real vault. The grid used to
 * read 1 / 2 / 3-4 / more, which is a sensible scale for someone who writes a
 * couple of notes a day and a solid block of maximum for anyone who writes
 * twenty — every cell saturated, no shape left to see.
 *
 * Scaling to the busiest day is the obvious fix and a worse one: import two
 * hundred notes in an afternoon and every ordinary day of the year collapses
 * into the lowest step. So the bands come from the distribution rather than
 * from its extremes — quartiles over the days that had any activity at all,
 * the way GitHub's does. An outlier lands in the top band and takes nothing
 * with it, because a quartile does not care how far past it a value sits.
 */

/** Shades above "nothing happened", which is always its own step. */
export const HEAT_STEPS = 4

/**
 * The value at `p` through `sorted`, by nearest rank.
 *
 * Nearest rank rather than an interpolating quantile because these are counts
 * of notes: a cut point of 2.5 notes describes nothing anyone wrote.
 */
function quantile(sorted: number[], p: number): number {
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/**
 * The three cut points between the four shades, given every day's count.
 *
 * Days with nothing on them are left out: they already have a step of their
 * own, and counting them would drag every cut point to zero on any vault with
 * more quiet days than busy ones — which is every vault.
 */
export function heatThresholds(counts: Iterable<number>): [number, number, number] {
  const active = [...counts].filter((count) => count > 0).sort((a, b) => a - b)
  // Nothing has happened yet, so no cut point can be honest. Anything above
  // zero being the top shade is the least surprising answer for one note.
  if (!active.length) return [0, 0, 0]
  return [quantile(active, 0.25), quantile(active, 0.5), quantile(active, 0.75)]
}

/** Which shade a day's count draws at, 0 (nothing) through `HEAT_STEPS`. */
export function heatLevel(count: number, thresholds: [number, number, number]): number {
  if (!(count > 0)) return 0
  const [q1, q2, q3] = thresholds
  if (count <= q1) return 1
  if (count <= q2) return 2
  if (count <= q3) return 3
  return HEAT_STEPS
}
