import { expect, test, vi } from 'vitest'
vi.mock('../../src/main/vault', () => ({ readNote: async (path: string) => ({
  ok: true, data: { content: path === 'exact.md' ? 'alpha beta' : 'alpha separate beta', mtime: 0 }
}) }))
import { resetSearch, upsertDoc, search } from '../../src/main/search'
import { resolveLink } from '../../src/shared/markdown-parse'
import { isPubliclyRoutable } from '../../src/main/netGuard'

test('reproduces explicit relative links opening the wrong note', () => {
  expect(resolveLink('./Thing.md', 'Folder/Source.md', ['Thing.md', 'Folder/Thing.md'])).toBe('Thing.md')
  expect(resolveLink('../Thing.mdx', 'Folder/Source.md', ['Thing.md', 'Thing.mdx'])).toBe('Thing.md')
})

test('reproduces phrase limit applied before phrase filtering', async () => {
  resetSearch()
  upsertDoc('decoy.md', 'alpha beta', [], 'alpha separate beta')
  upsertDoc('exact.md', 'unrelated title', [], 'alpha beta')
  expect((await search('"alpha beta"', 2)).map(hit => hit.path)).toEqual(['exact.md'])
  expect(await search('"alpha beta"', 1)).toEqual([])
})

test('reproduces private IPv4 mapped IPv6 address accepted as public', async () => {
  expect(await isPubliclyRoutable('http://[::ffff:127.0.0.1]/')).toBe(true)
  expect(await isPubliclyRoutable('http://[::ffff:192.168.1.1]/')).toBe(true)
})

test('measures the full link-resolution pass used on each index snapshot', () => {
  const measurements = []
  for (const size of [1000, 2000, 4000]) {
    const paths = Array.from({ length: size }, (_, i) => `Folder/Note${i}.md`)
    const start = performance.now()
    for (let i = 0; i < size; i++) resolveLink('unresolved target', paths[i], paths)
    measurements.push({ notes: size, links: size, ms: Math.round(performance.now() - start) })
  }
  console.log('Link resolution benchmark:', JSON.stringify(measurements))
}, 60000)
