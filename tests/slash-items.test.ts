import { describe, expect, it } from 'vitest'
import { matchSlashItems, type SlashItem } from '@shared/slashItems'

const noop = (): void => {}

const items: SlashItem[] = [
  { id: 'format.bold', label: 'Bold', detail: '', group: 'Format', apply: noop },
  { id: 'format.h1', label: 'Heading 1', detail: '', group: 'Format', apply: noop },
  { id: 'insert.table', label: 'Table', detail: '', group: 'Insert', apply: noop },
  { id: 'insert.rotate', label: 'Rotate', detail: '', group: 'Insert', apply: noop }
]

describe('matchSlashItems', () => {
  it('returns every item, grouped, for an empty query', () => {
    const result = matchSlashItems('', items)
    expect(result).toHaveLength(items.length)
    const firstInsert = result.findIndex((i) => i.group === 'Insert')
    expect(result.slice(0, firstInsert).every((i) => i.group === 'Format')).toBe(true)
  })

  it('ranks a prefix match ahead of a substring match', () => {
    // "ta" is a prefix of "Table" and a substring of "Rotate".
    const result = matchSlashItems('ta', items)
    expect(result.map((i) => i.id)).toEqual(['insert.table', 'insert.rotate'])
  })

  it('excludes items that do not match at all', () => {
    expect(matchSlashItems('zzz', items)).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    expect(matchSlashItems('TABLE', items).map((i) => i.id)).toEqual(['insert.table'])
  })

  it('searches multi-word command labels', () => {
    expect(matchSlashItems('heading 1', items).map((i) => i.id)).toEqual(['format.h1'])
  })

  it('supports compact fuzzy searches', () => {
    expect(matchSlashItems('h1', items).map((i) => i.id)).toEqual(['format.h1'])
  })

  it('breaks ties alphabetically within a group', () => {
    const result = matchSlashItems('', [items[3], items[2]])
    expect(result.map((i) => i.id)).toEqual(['insert.rotate', 'insert.table'])
  })
})

describe('custom commands in the ranking', () => {
  const custom: SlashItem[] = [
    { id: 'custom.1', label: 'table-of-contents', detail: '', group: 'Custom', apply: noop }
  ]

  it('sorts the user\'s own commands after the built-in groups', () => {
    const result = matchSlashItems('ta', [...items, ...custom])
    expect(result.map((i) => i.id)).toEqual(['insert.table', 'custom.1', 'insert.rotate'])
  })

  it('keeps a custom command that is the only match', () => {
    expect(matchSlashItems('table-of', [...items, ...custom]).map((i) => i.id)).toEqual(['custom.1'])
  })
})
