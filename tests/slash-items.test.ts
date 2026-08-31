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

  it('breaks ties alphabetically within a group', () => {
    const result = matchSlashItems('', [items[3], items[2]])
    expect(result.map((i) => i.id)).toEqual(['insert.rotate', 'insert.table'])
  })
})
