import { describe, expect, it } from 'vitest'
import type { HomeWidget } from '@shared/types'
import {
  clampToColumns,
  compact,
  findFreeSpot,
  normalizeLayout,
  placeWidget,
  rectsOverlap
} from '@shared/homeLayout'

const widget = (id: string, x: number, y: number, w = 1, h = 1): HomeWidget => ({
  id,
  type: 'clock',
  x,
  y,
  w,
  h,
  config: {}
})

const positions = (widgets: HomeWidget[]): string[] =>
  widgets.map((w) => `${w.id}@${w.x},${w.y} ${w.w}x${w.h}`)

describe('rectsOverlap', () => {
  it('is false for rectangles that only touch', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false)
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false)
  })

  it('is true for a single shared cell', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true)
  })
})

describe('clampToColumns', () => {
  it('pulls a widget back inside the board', () => {
    expect(clampToColumns(widget('a', 3, 0, 2), 4)).toMatchObject({ x: 2, w: 2 })
  })

  it('narrows a widget wider than the board', () => {
    expect(clampToColumns(widget('a', 0, 0, 4), 2)).toMatchObject({ x: 0, w: 2 })
  })

  it('honours a minimum size', () => {
    expect(clampToColumns(widget('a', 0, 0, 1, 1), 4, { w: 2, h: 2 })).toMatchObject({ w: 2, h: 2 })
  })

  it('rounds fractional coordinates and refuses negatives', () => {
    expect(clampToColumns({ ...widget('a', -3, -2), w: 1.6, h: 0.4 }, 4)).toMatchObject({
      x: 0,
      y: 0,
      w: 2,
      h: 1
    })
  })

  it('returns the same object when nothing has to change', () => {
    const w = widget('a', 1, 1)
    expect(clampToColumns(w, 4)).toBe(w)
  })
})

describe('compact', () => {
  it('floats widgets up into the space above them', () => {
    expect(positions(compact([widget('a', 0, 4), widget('b', 1, 7)], 4))).toEqual([
      'a@0,0 1x1',
      'b@1,0 1x1'
    ])
  })

  it('closes the hole a removed widget leaves behind', () => {
    const board = [widget('top', 0, 0, 2, 2), widget('below', 0, 2, 2, 1)]
    const afterRemoval = board.filter((w) => w.id !== 'top')
    expect(positions(compact(afterRemoval, 4))).toEqual(['below@0,0 2x1'])
  })

  it('separates widgets that were stored overlapping', () => {
    expect(positions(compact([widget('a', 0, 0, 2, 2), widget('b', 1, 1, 2, 2)], 4))).toEqual([
      'a@0,0 2x2',
      'b@1,2 2x2'
    ])
  })

  it('leaves a widget where it is when the cell above is taken', () => {
    expect(positions(compact([widget('a', 0, 0, 2, 1), widget('b', 0, 1, 2, 1)], 4))).toEqual([
      'a@0,0 2x1',
      'b@0,1 2x1'
    ])
  })

  it('lets a narrow widget rise past a wide one beside it', () => {
    const board = [widget('wide', 0, 0, 3, 2), widget('narrow', 3, 4, 1, 1)]
    expect(positions(compact(board, 4))).toEqual(['wide@0,0 3x2', 'narrow@3,0 1x1'])
  })
})

describe('placeWidget', () => {
  it('gives the moved widget the cells it was dropped on', () => {
    const board = [widget('a', 0, 0, 2, 1), widget('b', 0, 1, 2, 1)]
    const moved = { ...board[1], y: 0 }
    const result = placeWidget(board, moved, 4)
    expect(result.find((w) => w.id === 'b')).toMatchObject({ x: 0, y: 0 })
    expect(result.find((w) => w.id === 'a')).toMatchObject({ x: 0, y: 1 })
  })

  it('drops a widget into a free column without disturbing anyone', () => {
    const board = [widget('a', 0, 0, 2, 2), widget('b', 2, 0, 2, 2)]
    const result = placeWidget(board, { ...board[1], x: 2, y: 2 }, 4)
    expect(positions(result)).toEqual(['a@0,0 2x2', 'b@2,0 2x2'])
  })

  it('clamps a resize to the board and to the widget minimum', () => {
    const board = [widget('a', 2, 0, 2, 2)]
    const result = placeWidget(board, { ...board[0], w: 6, h: 1 }, 4, { w: 1, h: 2 })
    expect(result[0]).toMatchObject({ x: 0, w: 4, h: 2 })
  })

  it('adds a widget that is not on the board yet', () => {
    const board = [widget('a', 0, 0, 4, 1)]
    const result = placeWidget(board, widget('new', 0, 1, 2, 1), 4)
    expect(positions(result)).toEqual(['a@0,0 4x1', 'new@0,1 2x1'])
  })
})

describe('findFreeSpot', () => {
  it('fills the gap beside a widget before starting a new row', () => {
    expect(findFreeSpot([widget('a', 0, 0, 2, 1)], { w: 2, h: 1 }, 4)).toEqual({ x: 2, y: 0 })
  })

  it('starts a new row when the current one cannot take it', () => {
    expect(findFreeSpot([widget('a', 0, 0, 3, 1)], { w: 2, h: 1 }, 4)).toEqual({ x: 0, y: 1 })
  })

  it('places the first widget at the origin', () => {
    expect(findFreeSpot([], { w: 2, h: 2 }, 4)).toEqual({ x: 0, y: 0 })
  })
})

describe('normalizeLayout', () => {
  it('reads a hand-edited file back as a settled board', () => {
    const result = normalizeLayout({
      version: 1,
      columns: 4,
      widgets: [
        { id: 'a', type: 'clock', x: 9, y: -4, w: 9, h: 2, config: { showSeconds: true } },
        { id: 'b', type: 'recent', x: 0, y: 0, w: 2, h: 2, config: {} }
      ]
    })
    expect(result.columns).toBe(4)
    expect(result.widgets.find((w) => w.id === 'a')).toMatchObject({ x: 0, y: 0, w: 4, h: 2 })
    expect(result.widgets.find((w) => w.id === 'b')).toMatchObject({ y: 2 })
    expect(result.widgets[0].config).toEqual({ showSeconds: true })
  })

  it('keeps a widget whose type the registry no longer knows', () => {
    const result = normalizeLayout({ columns: 4, widgets: [{ id: 'a', type: 'weather', x: 0, y: 0, w: 2, h: 1 }] })
    expect(result.widgets).toHaveLength(1)
    expect(result.widgets[0].type).toBe('weather')
  })

  it('drops entries that are not widgets at all, and duplicate ids', () => {
    const result = normalizeLayout({
      widgets: [
        null,
        'clock',
        { type: 'clock', x: 0, y: 0, w: 1, h: 1 },
        { id: 'a', type: 'clock', x: 0, y: 0, w: 1, h: 1 },
        { id: 'a', type: 'recent', x: 1, y: 0, w: 1, h: 1 }
      ]
    })
    expect(result.widgets.map((w) => w.type)).toEqual(['clock'])
  })

  it('falls back to a sane board for junk', () => {
    expect(normalizeLayout(null)).toEqual({ version: 1, columns: 4, widgets: [] })
    expect(normalizeLayout({ columns: 400, widgets: {} })).toMatchObject({ columns: 12, widgets: [] })
  })
})

describe('normalizeLayout, cover', () => {
  it('keeps a cover and clamps its focal point', () => {
    const result = normalizeLayout({
      columns: 4,
      widgets: [],
      cover: { path: '.lumina/home/beach.jpg', position: 140 }
    })
    expect(result.cover).toEqual({ path: '.lumina/home/beach.jpg', position: 100 })
  })

  it('centres a cover that never said where to look', () => {
    const result = normalizeLayout({ widgets: [], cover: { path: 'a.png' } })
    expect(result.cover).toEqual({ path: 'a.png', position: 50 })
  })

  it('drops a cover with nothing to show', () => {
    expect(normalizeLayout({ widgets: [], cover: { position: 20 } }).cover).toBeUndefined()
    expect(normalizeLayout({ widgets: [], cover: 'beach.jpg' }).cover).toBeUndefined()
  })

  it('leaves the key out entirely when there is no cover', () => {
    expect('cover' in normalizeLayout({ widgets: [] })).toBe(false)
  })
})
