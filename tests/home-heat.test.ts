import { describe, expect, it } from 'vitest'
import { HEAT_STEPS, heatLevel, heatThresholds } from '@shared/homeHeat'

/** Every count drawn at its shade, for reading a whole distribution at once. */
const levels = (counts: number[]): number[] => {
  const thresholds = heatThresholds(counts)
  return counts.map((count) => heatLevel(count, thresholds))
}

describe('heatLevel', () => {
  it('gives a day with nothing on it a step of its own', () => {
    expect(heatLevel(0, [1, 2, 3])).toBe(0)
  })

  it('never gives an active day the empty step', () => {
    expect(heatLevel(1, [4, 8, 12])).toBe(1)
  })

  it('tops out at the last shade', () => {
    expect(heatLevel(1000, [1, 2, 3])).toBe(HEAT_STEPS)
  })

  it('is not confused by a negative or missing count', () => {
    expect(heatLevel(-1, [1, 2, 3])).toBe(0)
    expect(heatLevel(Number.NaN, [1, 2, 3])).toBe(0)
  })
})

describe('heatThresholds', () => {
  it('splits a spread of counts across all four shades', () => {
    // The fixed scale this replaced put everything from 5 upward at maximum.
    expect(levels([1, 2, 3, 5, 8, 13, 21])).toEqual([1, 1, 2, 2, 3, 3, 4])
  })

  it('uses the whole scale on a vault that writes in volume', () => {
    const busy = [12, 18, 24, 31, 40, 55, 70, 90]
    expect(new Set(levels(busy)).size).toBe(HEAT_STEPS)
  })

  it('ignores the quiet days when placing the cut points', () => {
    // Most days in any vault are empty; counting them would drag every cut
    // point to zero and paint every active day the top shade.
    const sparse = [0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 8, 13, 21]
    expect(levels(sparse)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4])
  })

  // The reason this is quartiles and not "scale to the busiest day".
  it('lets an outlier sit at the top without flattening the rest', () => {
    const ordinary = [1, 2, 3, 5, 8, 13, 21]
    const withImport = [...ordinary, 500]
    expect(levels(withImport).slice(0, ordinary.length)).toEqual(levels(ordinary))
    expect(levels(withImport).at(-1)).toBe(HEAT_STEPS)
  })

  it('keeps the ordinary days spread out when several imports land', () => {
    // Not exact equality here: three huge days out of eleven are a quarter of
    // the distribution, and a quartile is right to move for them. What has to
    // hold is that the ordinary days keep their shape — scaling to the busiest
    // day would put every one of these in the lowest step.
    const ordinary = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 26, 30]
    const drawn = levels([...ordinary, 400, 650, 900]).slice(0, ordinary.length)
    expect(new Set(drawn).size).toBe(HEAT_STEPS)
  })

  it('draws a uniform vault uniformly', () => {
    // Nothing stands out, so nothing is drawn as though it does.
    expect(levels([3, 3, 3, 3])).toEqual([1, 1, 1, 1])
  })

  it('has an answer for a vault where nothing has happened', () => {
    expect(heatThresholds([])).toEqual([0, 0, 0])
    expect(levels([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('has an answer for a single active day', () => {
    expect(levels([0, 0, 7])).toEqual([0, 0, 1])
  })

  it('puts the cut points on counts that were actually written', () => {
    // Nearest rank, not an interpolating quantile: half a note is not a day.
    expect(heatThresholds([1, 2, 3, 4])).toEqual([1, 2, 3])
    expect(heatThresholds([2, 4])).toEqual([2, 2, 4])
  })

  it('does not care what order the days arrive in', () => {
    expect(heatThresholds([21, 1, 8, 3, 13, 2, 5])).toEqual(heatThresholds([1, 2, 3, 5, 8, 13, 21]))
  })
})
