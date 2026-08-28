import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isIgnored, isMarkdown, safeJoin, toRelative } from '../src/main/paths'

const VAULT = path.resolve('/tmp/vault')

describe('safeJoin', () => {
  it('resolves a normal note path', () => {
    expect(safeJoin(VAULT, 'Projects/Gloria.md')).toBe(
      path.join(VAULT, 'Projects', 'Gloria.md')
    )
  })

  it('accepts backslash separators', () => {
    expect(safeJoin(VAULT, 'Projects\\Gloria.md')).toBe(
      path.join(VAULT, 'Projects', 'Gloria.md')
    )
  })

  it('refuses to climb out of the vault', () => {
    expect(safeJoin(VAULT, '../secrets.md')).toBeNull()
    expect(safeJoin(VAULT, 'notes/../../secrets.md')).toBeNull()
    expect(safeJoin(VAULT, '/etc/passwd')).not.toBeNull() // treated as vault-relative
    expect(safeJoin(VAULT, '../../../../Windows/System32/config')).toBeNull()
  })

  it('refuses embedded null bytes', () => {
    expect(safeJoin(VAULT, `note${String.fromCharCode(0)}.md`)).toBeNull()
  })

  it('allows the vault root itself', () => {
    expect(safeJoin(VAULT, '')).toBe(VAULT)
  })
})

describe('toRelative', () => {
  it('returns forward-slash vault-relative paths', () => {
    expect(toRelative(VAULT, path.join(VAULT, 'a', 'b.md'))).toBe('a/b.md')
  })
})

describe('isIgnored', () => {
  it('skips app and tooling folders at any depth', () => {
    expect(isIgnored('.lumina/settings.json')).toBe(true)
    expect(isIgnored('notes/.git/config')).toBe(true)
    expect(isIgnored('node_modules/thing/readme.md')).toBe(true)
    expect(isIgnored('.hidden/note.md')).toBe(true)
  })

  it('leaves ordinary notes alone', () => {
    expect(isIgnored('Projects/Gloria.md')).toBe(false)
    expect(isIgnored('Welcome.md')).toBe(false)
  })
})

describe('isMarkdown', () => {
  it('recognises the markdown extensions and nothing else', () => {
    expect(isMarkdown('a.md')).toBe(true)
    expect(isMarkdown('a.MARKDOWN')).toBe(true)
    expect(isMarkdown('a.png')).toBe(false)
    expect(isMarkdown('a')).toBe(false)
  })
})
