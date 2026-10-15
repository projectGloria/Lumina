/**
 * Which application a double-clicked file lands in.
 *
 * This runs before `app.ready` and there is no UI to correct it afterwards, so
 * a wrong answer here is a file that opens in the wrong editor — or, for a
 * vault note sent to Quick Note, a note edited outside the index that the
 * graph and backlinks never learn about. The environment is injected so the
 * rules can be exercised without a real vault on disk.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { documentArgsFrom, isVaultNote, liveRouteEnv, readKnownVaults, routeForFiles, type RouteEnv } from '../src/main/fileRoute'

/** A vault at `C:/Vault` (or `/Vault`), and nothing else on the disk. */
const VAULT = path.resolve('/Vault')
const env: RouteEnv = {
  isVaultDir: (dir) => path.resolve(dir) === VAULT,
  knownVaults: []
}

const inVault = (...parts: string[]): string => path.join(VAULT, ...parts)
const elsewhere = (...parts: string[]): string => path.join(path.resolve('/Downloads'), ...parts)

describe('routing a file to an application', () => {
  it('sends a markdown note inside a vault to Vault', () => {
    expect(routeForFiles([inVault('Ideas.md')], env)).toBe('vault')
  })

  it('sends a note in a nested folder to Vault', () => {
    expect(routeForFiles([inVault('Projects', 'deep', 'Notes.md')], env)).toBe('vault')
  })

  it('sends markdown outside any vault to Quick Note', () => {
    expect(routeForFiles([elsewhere('README.md')], env)).toBe('quicknote')
  })

  it('sends every non-markdown text file to Quick Note, vault or not', () => {
    expect(routeForFiles([elsewhere('notes.txt')], env)).toBe('quicknote')
    expect(routeForFiles([elsewhere('server.js')], env)).toBe('quicknote')
    // Even sitting inside the vault: a `.txt` is not a note, and Vault has
    // nothing to show for it.
    expect(routeForFiles([inVault('scratch.txt')], env)).toBe('quicknote')
  })

  it('treats a plain launch with no file as Vault', () => {
    expect(routeForFiles([], env)).toBe('vault')
    expect(routeForFiles([''], env)).toBe('vault')
  })

  it('decides on the first file when a selection disagrees', () => {
    // Quick Note can show every one of these; Vault could not. Deciding on the
    // first argument keeps one launch in one process and never drops a file.
    expect(routeForFiles([elsewhere('a.txt'), inVault('b.md')], env)).toBe('quicknote')
    expect(routeForFiles([inVault('b.md'), elsewhere('a.txt')], env)).toBe('vault')
  })

  it('counts a remembered vault root even with no .lumina folder on disk', () => {
    const remembered: RouteEnv = { isVaultDir: () => false, knownVaults: [VAULT] }
    expect(isVaultNote(inVault('Ideas.md'), remembered)).toBe(true)
    expect(isVaultNote(elsewhere('Ideas.md'), remembered)).toBe(false)
  })

  it('does not call a non-markdown file a vault note', () => {
    expect(isVaultNote(inVault('data.json'), env)).toBe(false)
  })
})

describe('file arguments on the command line', () => {
  it('skips the binary, and one more when not packaged', () => {
    expect(documentArgsFrom(['lumina.exe', 'a.txt'], true)).toEqual(['a.txt'])
    expect(documentArgsFrom(['electron.exe', '.', 'a.txt'], false)).toEqual(['a.txt'])
  })

  it('ignores switches so Chromium flags never look like a file', () => {
    expect(documentArgsFrom(['lumina.exe', '--quicknote', '--no-sandbox', 'a.md'], true)).toEqual(['a.md'])
  })

  it('accepts every text type, unlike the notes-only sibling', () => {
    const argv = ['lumina.exe', 'a.md', 'b.txt', 'c.json', 'd.png']
    expect(documentArgsFrom(argv, true)).toEqual(['a.md', 'b.txt', 'c.json'])
  })
})

describe('reading the remembered vaults out of lumina.json', () => {
  it('collects the last vault, the recent list and every profile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-route-'))
    const a = path.resolve('/A')
    const b = path.resolve('/B')
    const c = path.resolve('/C')
    await fs.writeFile(
      path.join(dir, 'lumina.json'),
      JSON.stringify({
        lastVault: a,
        recentVaults: [{ path: b }, { path: 'relative/not/absolute' }],
        profiles: [{ vaultPath: c }, { vaultPath: null }]
      }),
      'utf8'
    )

    const known = readKnownVaults(dir)
    expect(known).toContain(a)
    expect(known).toContain(b)
    expect(known).toContain(c)
    // A relative path is not a vault root and would make `contains` nonsense.
    expect(known).not.toContain('relative/not/absolute')

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reports nothing rather than throwing when the config is missing or corrupt', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-route-'))
    // Absent: a first launch, which must still route rather than crash.
    expect(readKnownVaults(dir)).toEqual([])

    await fs.writeFile(path.join(dir, 'lumina.json'), '{ not json', 'utf8')
    expect(readKnownVaults(dir)).toEqual([])

    // And the live environment built on it still answers.
    expect(liveRouteEnv(dir).knownVaults).toEqual([])
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('the vault marker on a real filesystem', () => {
  it('finds a .lumina folder on an ancestor and stops at one that has none', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-vault-'))
    const vault = path.join(root, 'Vault')
    const nested = path.join(vault, 'Projects', 'Deep')
    await fs.mkdir(path.join(vault, '.lumina'), { recursive: true })
    await fs.mkdir(nested, { recursive: true })

    const live = liveRouteEnv(root)
    expect(isVaultNote(path.join(nested, 'Note.md'), live)).toBe(true)
    expect(isVaultNote(path.join(root, 'Loose.md'), live)).toBe(false)

    await fs.rm(root, { recursive: true, force: true })
  })
})
