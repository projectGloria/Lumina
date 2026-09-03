import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, dayKey, dayPartOf, heatmapDays, startOfDay } from '@shared/homeDates'

/**
 * These are timezone questions, so the timezone is part of the fixture. Node
 * honours a change to `process.env.TZ` at runtime; the original is put back so
 * nothing else sharing this worker sees a different clock.
 */
const ORIGINAL_TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'Europe/London'
})
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

// Built on demand rather than at module load, which happens before the
// timezone above is in effect — a `Date` made under one zone and read under
// another is a different day.
/** The BST switch in 2025: 01:00 on 30 March, the day the old code lost. */
const springForward = (): Date => new Date(2025, 2, 30)
/** The GMT switch in 2025: 02:00 on 26 October. */
const fallBack = (): Date => new Date(2025, 9, 26)

const keys = (grid: Date[][]): string[] => grid.flat().map(dayKey)

describe('the fixture timezone', () => {
  it('really is one with a DST transition, or these tests prove nothing', () => {
    const winter = new Date(2025, 0, 15).getTimezoneOffset()
    const summer = new Date(2025, 6, 15).getTimezoneOffset()
    expect(winter).not.toBe(summer)
  })
})

describe('addDays', () => {
  it('lands on local midnight across a clocks-forward night', () => {
    const next = addDays(new Date(2025, 2, 29), 1)
    expect(dayKey(next)).toBe(dayKey(springForward()))
    expect([next.getHours(), next.getMinutes()]).toEqual([0, 0])
  })

  it('lands on local midnight across a clocks-back night', () => {
    const next = addDays(new Date(2025, 9, 25), 1)
    expect(dayKey(next)).toBe(dayKey(fallBack()))
    expect(next.getHours()).toBe(0)
  })

  it('steps backwards over a clocks-forward night too', () => {
    expect(dayKey(addDays(new Date(2025, 2, 31), -1))).toBe(dayKey(springForward()))
  })

  it('crosses a month end and a leap day', () => {
    expect(dayKey(addDays(new Date(2025, 0, 31), 1))).toBe(dayKey(new Date(2025, 1, 1)))
    expect(dayKey(addDays(new Date(2024, 1, 28), 1))).toBe(dayKey(new Date(2024, 1, 29)))
    expect(dayKey(addDays(new Date(2025, 11, 31), 1))).toBe(dayKey(new Date(2026, 0, 1)))
  })

  it('normalizes a timestamp to the day it falls in', () => {
    expect(dayKey(startOfDay(new Date(2025, 2, 30, 23, 59)))).toBe(dayKey(springForward()))
  })
})

describe('heatmapDays', () => {
  it('draws seven days a column, oldest column first', () => {
    const grid = heatmapDays(new Date(2025, 5, 11), 4)
    expect(grid).toHaveLength(4)
    expect(grid.every((column) => column.length === 7)).toBe(true)
    expect(grid[0][0].getTime()).toBeLessThan(grid[3][6].getTime())
  })

  it('ends on the Saturday of the given week and starts on a Sunday', () => {
    // A Wednesday: the grid still runs to that week's Saturday.
    const grid = heatmapDays(new Date(2025, 5, 11), 3)
    expect(grid[0][0].getDay()).toBe(0)
    expect(dayKey(grid[2][6])).toBe(dayKey(new Date(2025, 5, 14)))
  })

  it('starts each column on a Sunday', () => {
    const grid = heatmapDays(new Date(2025, 2, 30), 6)
    expect(grid.map((column) => column[0].getDay())).toEqual([0, 0, 0, 0, 0, 0])
  })

  // The bug: with 24-hour stepping this grid ran 29, 31 March — the day the
  // clocks went forward had no cell, so notes written on it were invisible and
  // every cell before it sat under the wrong column.
  it('gives the clocks-forward day a cell of its own', () => {
    const grid = heatmapDays(new Date(2025, 3, 5), 3)
    expect(keys(grid)).toContain(dayKey(springForward()))
  })

  it('gives the clocks-back day exactly one cell', () => {
    const grid = heatmapDays(new Date(2025, 10, 2), 3)
    expect(keys(grid).filter((key) => key === dayKey(fallBack()))).toHaveLength(1)
  })

  it('is a run of consecutive days with no gap or repeat, over both switches', () => {
    for (const today of [new Date(2025, 3, 5), new Date(2025, 10, 2), new Date(2026, 0, 3)]) {
      const days = heatmapDays(today, 53).flat()
      expect(new Set(days.map(dayKey)).size).toBe(days.length)
      for (let i = 1; i < days.length; i++) {
        expect(dayKey(days[i])).toBe(dayKey(addDays(days[i - 1], 1)))
      }
    }
  })

  it('survives a nonsense week count from a hand-edited board', () => {
    expect(heatmapDays(new Date(2025, 5, 11), Number.NaN)).toHaveLength(1)
    expect(heatmapDays(new Date(2025, 5, 11), 0)).toHaveLength(1)
  })
})

describe('dayPartOf', () => {
  const at = (hour: number, minute = 0): string =>
    dayPartOf(new Date(2025, 5, 11, hour, minute))

  it('names each band', () => {
    expect(at(2)).toBe('night')
    expect(at(8)).toBe('morning')
    expect(at(14)).toBe('afternoon')
    expect(at(21)).toBe('evening')
  })

  it('changes on the hour the band changes, not before it', () => {
    expect(at(4, 59)).toBe('night')
    expect(at(5, 0)).toBe('morning')
    expect(at(11, 59)).toBe('morning')
    expect(at(12, 0)).toBe('afternoon')
    expect(at(17, 59)).toBe('afternoon')
    expect(at(18, 0)).toBe('evening')
  })

  it('covers midnight and the last minute of the day', () => {
    expect(at(0, 0)).toBe('night')
    expect(at(23, 59)).toBe('evening')
  })

  it('covers all twenty-four hours with no gap', () => {
    const parts = Array.from({ length: 24 }, (_, hour) => at(hour))
    expect(parts.filter(Boolean)).toHaveLength(24)
    expect(new Set(parts).size).toBe(4)
  })
})
