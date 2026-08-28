import { describe, expect, it } from 'vitest'
import { buildAliasMap, parseNote, resolveLink } from '@shared/markdown-parse'
import { STARTER } from '../src/main/starter'

/**
 * The notes a new vault is seeded with are the first thing anyone sees, so
 * they are held to the same standard as the parser: every link they contain
 * has to land, and the tags they mention have to be the ones they meant.
 */
describe('starter vault', () => {
  const entries = Object.entries(STARTER).map(([path, content]) => parseNote(path, content))
  const paths = entries.map((e) => e.path)
  const aliases = buildAliasMap(entries)

  it('ships more than one note so the graph is not a single dot', () => {
    expect(entries.length).toBeGreaterThan(3)
  })

  it('resolves every link it contains', () => {
    const broken: string[] = []
    for (const entry of entries) {
      for (const link of entry.links) {
        if (!resolveLink(link.target, entry.path, paths, aliases)) {
          broken.push(`${entry.path} -> [[${link.target}]]`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('gives every note at least one inbound link', () => {
    const linked = new Set<string>()
    for (const entry of entries) {
      for (const link of entry.links) {
        const to = resolveLink(link.target, entry.path, paths, aliases)
        if (to && to !== entry.path) linked.add(to)
      }
    }
    const orphans = paths.filter((p) => !linked.has(p))
    expect(orphans).toEqual([])
  })

  it('does not pick up code samples as tags', () => {
    const tags = new Set(entries.flatMap((e) => e.tags))
    expect([...tags].some((t) => /^[0-9a-f]{6}$/i.test(t))).toBe(false)
  })

  it('titles every note', () => {
    for (const entry of entries) expect(entry.title.trim()).not.toBe('')
  })
})
