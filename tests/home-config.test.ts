import { describe, expect, it } from 'vitest'
import { mergeWidgetConfig, oneOf } from '@shared/homeConfig'

const defaults = { count: 12, folder: '', showDone: false }

describe('mergeWidgetConfig', () => {
  it('lays stored options over the defaults', () => {
    expect(mergeWidgetConfig(defaults, { count: 3, showDone: true })).toEqual({
      count: 3,
      folder: '',
      showDone: true
    })
  })

  it('fills in a key the stored config has never heard of', () => {
    expect(mergeWidgetConfig(defaults, { count: 3 }).showDone).toBe(false)
  })

  it('takes nothing at all from a missing or unusable config', () => {
    expect(mergeWidgetConfig(defaults, undefined)).toEqual(defaults)
    expect(mergeWidgetConfig(defaults, [] as unknown as Record<string, unknown>)).toEqual(defaults)
  })

  // Each of these reached a widget and read as an empty vault rather than as a
  // typo: `slice(0, NaN)` is an empty list, `repeat(NaN, 1fr)` is no grid.
  it('refuses a value of the wrong type', () => {
    expect(mergeWidgetConfig(defaults, { count: 'lots' }).count).toBe(12)
    expect(mergeWidgetConfig(defaults, { count: null }).count).toBe(12)
    expect(mergeWidgetConfig(defaults, { showDone: 'yes' }).showDone).toBe(false)
    expect(mergeWidgetConfig(defaults, { folder: 12 }).folder).toBe('')
  })

  it('refuses a number that is not one', () => {
    expect(mergeWidgetConfig(defaults, { count: Number.NaN }).count).toBe(12)
    expect(mergeWidgetConfig(defaults, { count: Number.POSITIVE_INFINITY }).count).toBe(12)
  })

  it('keeps a legitimate zero, empty string and false', () => {
    const merged = mergeWidgetConfig({ n: 5, s: 'x', b: true }, { n: 0, s: '', b: false })
    expect(merged).toEqual({ n: 0, s: '', b: false })
  })

  it('ignores a key the widget does not read', () => {
    expect(mergeWidgetConfig(defaults, { count: 2, fromALaterBuild: 'kept in the file' })).toEqual({
      count: 2,
      folder: '',
      showDone: false
    })
  })

  it('does not mutate either input', () => {
    const stored = { count: 4 }
    const before = { ...defaults }
    mergeWidgetConfig(defaults, stored)
    expect(defaults).toEqual(before)
    expect(stored).toEqual({ count: 4 })
  })

  it('holds an object or array default to its own shape', () => {
    const withShapes = { list: ['a'], map: { k: 1 } }
    expect(mergeWidgetConfig(withShapes, { list: 'a', map: [] })).toEqual(withShapes)
    expect(mergeWidgetConfig(withShapes, { list: ['b'], map: { k: 2 } })).toEqual({
      list: ['b'],
      map: { k: 2 }
    })
  })
})

describe('oneOf', () => {
  const days = ['monday', 'sunday'] as const

  it('takes a word from the set', () => {
    expect(oneOf('sunday', days, 'monday')).toBe('sunday')
  })

  it('falls back on anything else', () => {
    expect(oneOf('chaos', days, 'monday')).toBe('monday')
    expect(oneOf(undefined, days, 'monday')).toBe('monday')
    expect(oneOf(7, days, 'monday')).toBe('monday')
  })
})
