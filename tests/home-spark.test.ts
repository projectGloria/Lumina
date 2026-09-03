import { describe, expect, it } from 'vitest'
import { sparkShape } from '@shared/homeSpark'

/** Just the y values, which is where every interesting case lives. */
const ys = (values: number[]): number[] =>
  (sparkShape(values)?.line ?? '').split(' ').map((pair) => Number(pair.split(',')[1]))

describe('sparkShape', () => {
  it('has nothing to draw for fewer than two points', () => {
    expect(sparkShape([])).toBeNull()
    expect(sparkShape([5])).toBeNull()
  })

  it('spans the box, low to high', () => {
    const shape = sparkShape([0, 10])!
    const [first, last] = ys([0, 10])
    expect(first).toBeGreaterThan(last)
    expect(shape.line.startsWith('0,')).toBe(true)
  })

  it('spaces points evenly across the width', () => {
    const xs = sparkShape([1, 2, 3, 4, 5])!.line.split(' ').map((p) => Number(p.split(',')[0]))
    expect(xs).toEqual([0, 25, 50, 75, 100])
  })

  // A week of steady writing is not a week of nothing.
  it('draws an unchanging series through the middle, not along the floor', () => {
    const flat = ys([4, 4, 4, 4])
    expect(new Set(flat).size).toBe(1)
    expect(flat[0]).toBeGreaterThan(2)
    expect(flat[0]).toBeLessThan(30)
  })

  it('draws a flat zero the same way, rather than off the bottom', () => {
    expect(ys([0, 0, 0])).toEqual(ys([9, 9, 9]))
  })

  it('keeps both extremes inside the box', () => {
    const drawn = ys([0, 50, 3, 100, 7])
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...drawn)).toBeLessThanOrEqual(32)
  })

  it('scales to the series, so a quiet week is still legible', () => {
    // Two notes against one is the same picture as two hundred against one
    // hundred: the shape is what is being read, not the magnitude.
    expect(ys([1, 2])).toEqual(ys([100, 200]))
  })

  it('closes the area along the floor so the wash has a bottom', () => {
    const shape = sparkShape([1, 5, 2])!
    expect(shape.area.startsWith('0,32 ')).toBe(true)
    expect(shape.area.endsWith(' 100,32')).toBe(true)
  })

  it('survives a series with a negative in it', () => {
    expect(() => sparkShape([-3, 0, 4])).not.toThrow()
    const drawn = ys([-3, 0, 4])
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0)
  })
})
