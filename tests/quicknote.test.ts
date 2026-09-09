import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionCache } from '../src/main/quicknote/cache'
import { readDestination } from '../src/main/quicknote/config'
import { createNoteAt } from '../src/main/noteWriter'
import { parseSession, type Session } from '../src/shared/quicknoteSession'
const dirs: string[] = []
async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-qn-test-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))) })
const session: Session = { version: 1, buffers: [
  { id: 'one', createdAt: 1, updatedAt: 1, text: 'unfinished sentence', cursor: 7 },
  { id: 'two', createdAt: 2, updatedAt: 3, text: 'second draft', cursor: 4 }
] }
describe('Quick Note persistence', () => {
  it('restores multiple drafts and cursor positions after reopening', async () => {
    const file = path.join(await temp(), 'cache', 'session.json')
    await new SessionCache(file).write(session)
    expect(await new SessionCache(file).load()).toEqual(session)
  })
  it('serializes snapshots so an older write cannot replace the latest', async () => {
    const cache = new SessionCache(path.join(await temp(), 'session.json'))
    await Promise.all([cache.write(session), cache.write({ version: 1, buffers: [] })])
    expect((await cache.load()).buffers).toEqual([])
  })
  it('reports a corrupt cache without replacing it', async () => {
    const file = path.join(await temp(), 'session.json')
    await fs.writeFile(file, '{broken')
    await expect(new SessionCache(file).load()).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('{broken')
  })
  it('can retry after a filesystem failure', async () => {
    const dir = await temp()
    const parent = path.join(dir, 'cache')
    await fs.writeFile(parent, 'blocked')
    const cache = new SessionCache(path.join(parent, 'session.json'))
    await expect(cache.write(session)).rejects.toThrow()
    await fs.unlink(parent)
    await cache.write(session)
    expect(await cache.load()).toEqual(session)
  })
  it('rejects duplicate buffers and invalid cursor positions', () => {
    expect(() => parseSession({ version: 1, buffers: [session.buffers[0], session.buffers[0]] })).toThrow()
    expect(() => parseSession({ version: 1, buffers: [{ ...session.buffers[0], cursor: 999 }] })).toThrow()
  })
})
describe('Vault saves', () => {
  it('creates collision-safe notes concurrently and preserves self-write callbacks', async () => {
    const root = await temp()
    const marked: string[] = []
    const results = await Promise.all(['one', 'two'].map((text) => createNoteAt(root, 'Inbox/Note', text, (p) => marked.push(p))))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(new Set(results.map((r) => r.data)).size).toBe(2)
    const texts = await Promise.all(results.map((r) => fs.readFile(path.join(root, r.data!), 'utf8')))
    expect(texts.sort()).toEqual(['one', 'two'])
    expect(marked.length).toBeGreaterThanOrEqual(2)
  })
  it('refuses a path escaping the vault', async () => {
    const result = await createNoteAt(await temp(), '../outside', 'secret')
    expect(result.ok).toBe(false)
  })
  it('reads the current destination without modifying Vault configuration', async () => {
    const root = await temp()
    const file = path.join(root, 'lumina.json')
    const original = JSON.stringify({ activeProfileId: 'p', profiles: [{ id: 'p', vaultPath: root }], quickNote: { folder: 'Temporary' } })
    await fs.writeFile(file, original)
    expect(await readDestination(file)).toEqual({ root, folder: 'Temporary' })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    await fs.writeFile(file, JSON.stringify({ lastVault: root }))
    expect((await readDestination(file)).folder).toBe('Inbox')
  })
})
