/**
 * A row of numbers, as a line someone can read at a glance.
 *
 * The scaling is here rather than in the component because it is the part that
 * can be wrong in ways nobody notices: a flat series drawn as a flat line at
 * the bottom of its box looks like zero activity, and a single spike drawn
 * against itself looks like nothing happened on any other day. Both are
 * pinned in `tests/home-spark.test.ts`.
 */

export interface SparkShape {
  /** `x,y` pairs for a `<polyline>`, in the viewBox below. */
  line: string
  /** The same path closed along the floor, for the wash under it. */
  area: string
  width: number
  height: number
}

/** The viewBox everything is scaled into; the SVG itself stretches to the card. */
const WIDTH = 100
const HEIGHT = 32
/** Half the stroke, so a line at either extreme is not clipped in half. */
const INSET = 2

export function sparkShape(values: number[]): SparkShape | null {
  // One point is a dot, not a trend, and nothing is nothing.
  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min
  const step = WIDTH / (values.length - 1)
  const floor = HEIGHT - INSET
  const ceiling = INSET

  const points = values.map((value, i) => {
    const x = i * step
    // A series that never changes sits on its own middle rather than on the
    // floor, where a flat week of steady writing would read as a flat zero.
    const t = span === 0 ? 0.5 : (value - min) / span
    const y = floor - t * (floor - ceiling)
    return `${round(x)},${round(y)}`
  })

  return {
    line: points.join(' '),
    area: `0,${HEIGHT} ${points.join(' ')} ${round(WIDTH)},${HEIGHT}`,
    width: WIDTH,
    height: HEIGHT
  }
}

const round = (n: number): number => Math.round(n * 100) / 100
