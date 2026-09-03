import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ancestorDirs,
  contains,
  fileArgsFrom,
  isIgnored,
  isMarkdown,
  safeJoin,
  safePathUnder,
  safeVaultPath,
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

describe('safeVaultPath', () => {
  it('accepts in-vault files and new paths under real directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-safe-path-'))
    try {
      await fs.mkdir(path.join(root, 'Notes'))
      await fs.writeFile(path.join(root, 'Notes', 'Today.md'), 'safe')
      expect(await safeVaultPath(root, 'Notes/Today.md')).toBe(path.join(root, 'Notes', 'Today.md'))
      expect(await safeVaultPath(root, 'Notes/New.md', true)).toBe(path.join(root, 'Notes', 'New.md'))
      expect(await safeVaultPath(root, 'Notes/New.md')).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlink that escapes the vault', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-vault-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'secret.md'), 'outside')
      await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
      expect(await safeVaultPath(root, 'escape/secret.md')).toBeNull()
      expect(await safeVaultPath(root, 'escape/new.md', true)).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

/**
 * The same guard pointed at a root that is not a vault — the music folder is
 * the second one, and it is on an external drive or a share as often as not.
 */
describe('safePathUnder, on a root that is not the vault', () => {
  it('accepts a file inside the root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-music-'))
    try {
      await fs.mkdir(path.join(root, 'Album'))
      await fs.writeFile(path.join(root, 'Album', 'Track.mp3'), 'audio')
      expect(await safePathUnder(root, 'Album/Track.mp3')).toBe(
        path.join(root, 'Album', 'Track.mp3')
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  // A music folder is a folder someone else arranged, and a link in it must
  // not turn `lumina://music/...` into a reader for the whole disk.
  it('rejects a symlink that escapes it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-music-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-elsewhere-'))
    try {
      await fs.writeFile(path.join(outside, 'private.mp3'), 'not yours')
      await fs.symlink(
        outside,
        path.join(root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      expect(await safePathUnder(root, 'linked/private.mp3')).toBeNull()
      expect(await safePathUnder(root, 'linked/new.mp3', true)).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects traversal out of it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-music-'))
    try {
      expect(await safePathUnder(root, '../secrets.mp3')).toBeNull()
      expect(await safePathUnder(root, 'Album/../../secrets.mp3')).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('is the same function the vault guard is named after', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-alias-'))
    try {
      await fs.writeFile(path.join(root, 'a.md'), 'x')
      expect(await safeVaultPath(root, 'a.md')).toBe(await safePathUnder(root, 'a.md'))
      expect(await safeVaultPath(root, '../a.md')).toBe(await safePathUnder(root, '../a.md'))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
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
    expect(isMarkdown('a.mdx')).toBe(true)
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
