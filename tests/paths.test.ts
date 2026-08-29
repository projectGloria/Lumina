import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ancestorDirs,
  contains,
  fileArgsFrom,
  isIgnored,
  isMarkdown,
  safeJoin,
  samePath,
  toRelative,
  vaultContaining
} from '../src/main/paths'

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

/* -------------------------------------------- files handed over by the OS */

describe('fileArgsFrom', () => {
  const exe = 'C:\Program Files\Lumina\Lumina.exe'

  it('takes note paths after the binary when packaged', () => {
    expect(fileArgsFrom([exe, 'C:\Notes\Today.md'], true)).toEqual(['C:\Notes\Today.md'])
  })

  it('skips the app directory when running unpackaged', () => {
    expect(fileArgsFrom(['electron', '.', 'C:\Notes\Today.md'], false)).toEqual([
      'C:\Notes\Today.md'
    ])
  })

  it('ignores chromium switches', () => {
    expect(fileArgsFrom([exe, '--no-sandbox', '--inspect=9229'], true)).toEqual([])
  })

  it('ignores files it cannot open', () => {
    expect(fileArgsFrom([exe, 'C:\Notes\photo.png', 'C:\Notes\a.markdown'], true)).toEqual([
      'C:\Notes\a.markdown'
    ])
  })

  it('takes several notes at once', () => {
    expect(fileArgsFrom([exe, 'a.md', 'b.md'], true)).toEqual(['a.md', 'b.md'])
  })
})

describe('ancestorDirs', () => {
  it('walks up to the root, deepest first', () => {
    const dirs = ancestorDirs(path.join(VAULT, 'Projects', 'Deep'))
    expect(dirs[0]).toBe(path.join(VAULT, 'Projects', 'Deep'))
    expect(dirs[1]).toBe(path.join(VAULT, 'Projects'))
    expect(dirs[dirs.length - 1]).toBe(path.parse(VAULT).root)
  })

  it('terminates at the filesystem root', () => {
    const root = path.parse(VAULT).root
    expect(ancestorDirs(root)).toEqual([root])
  })
})

describe('contains', () => {
  it('accepts a file inside the root', () => {
    expect(contains(VAULT, path.join(VAULT, 'a', 'b.md'))).toBe(true)
  })

  it('accepts the root itself', () => {
    expect(contains(VAULT, VAULT)).toBe(true)
  })

  it('rejects a sibling folder with a shared prefix', () => {
    expect(contains(VAULT, `${VAULT}-backup/a.md`)).toBe(false)
  })
})

describe('samePath', () => {
  it('ignores separator style', () => {
    expect(samePath(VAULT, VAULT.split(path.sep).join('/'))).toBe(true)
  })

  it('separates different folders', () => {
    expect(samePath(VAULT, path.join(VAULT, 'sub'))).toBe(false)
  })
})

describe('vaultContaining', () => {
  const nested = path.join(VAULT, 'Nested')

  it('returns null when no vault owns the file', () => {
    expect(vaultContaining(path.join(VAULT, 'a.md'), ['/tmp/elsewhere'])).toBe(null)
  })

  it('prefers the most specific vault', () => {
    expect(vaultContaining(path.join(nested, 'a.md'), [VAULT, nested])).toBe(nested)
  })

  it('finds the vault whatever order the candidates arrive in', () => {
    expect(vaultContaining(path.join(nested, 'a.md'), [nested, VAULT])).toBe(nested)
  })
})
