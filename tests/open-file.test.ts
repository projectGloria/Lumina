import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFile, toRequest } from '../src/main/openFile'

/**
 * Double-clicking a note has to land in the right vault, and the wrong answer
 * is expensive: adopting the downloads folder as a vault would index thousands
 * of files the user never meant to open. These run against a real directory
 * tree because the whole question is what is on disk.
 */
describe('resolveFile', () => {
  let tmp: string
  let vault: string
  let nested: string
  let loose: string

  const write = async (file: string, body = '# note\n'): Promise<string> => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body, 'utf8')
    return file
  }

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-open-'))
    vault = path.join(tmp, 'Vault')
    nested = path.join(vault, 'Inner')
    loose = path.join(tmp, 'Loose')

    await fs.mkdir(path.join(vault, '.lumina'), { recursive: true })
    await fs.mkdir(path.join(nested, '.lumina'), { recursive: true })

    await write(path.join(vault, 'Top.md'))
    await write(path.join(vault, 'Projects', 'Gloria.md'))
    await write(path.join(nested, 'Deep.md'))
    await write(path.join(vault, '.lumina', 'Internal.md'))
    await write(path.join(loose, 'Stray.md'))
    await write(path.join(loose, 'photo.png'), 'not markdown')
  })

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('resolves a note against the vault already open', async () => {
    const res = await resolveFile(path.join(vault, 'Projects', 'Gloria.md'), vault, [])
    expect(res).toEqual({ path: 'Projects/Gloria.md', vault: path.resolve(vault), unknown: false })
  })

  it('finds the vault by its .lumina folder when none is open', async () => {
    const res = await resolveFile(path.join(vault, 'Top.md'), null, [])
    expect(res?.vault).toBe(path.resolve(vault))
    expect(res?.path).toBe('Top.md')
    expect(res?.unknown).toBe(false)
  })

  it('prefers the innermost vault for a nested note', async () => {
    const res = await resolveFile(path.join(nested, 'Deep.md'), null, [])
    expect(res?.vault).toBe(path.resolve(nested))
    expect(res?.path).toBe('Deep.md')
  })

  it('keeps the open vault rather than switching to a nested one', async () => {
    const res = await resolveFile(path.join(nested, 'Deep.md'), vault, [])
    expect(res?.vault).toBe(path.resolve(vault))
    expect(res?.path).toBe('Inner/Deep.md')
  })

  it('falls back to a vault the user opened before', async () => {
    const res = await resolveFile(path.join(loose, 'Stray.md'), null, [loose])
    expect(res?.vault).toBe(path.resolve(loose))
    expect(res?.unknown).toBe(false)
  })

  it('asks before adopting a folder nothing recognises', async () => {
    const res = await resolveFile(path.join(loose, 'Stray.md'), null, [])
    expect(res).toEqual({ path: 'Stray.md', vault: path.resolve(loose), unknown: true })
  })

  it('refuses a note buried in a folder the indexer ignores', async () => {
    expect(await resolveFile(path.join(vault, '.lumina', 'Internal.md'), vault, [])).toBe(null)
  })

  it('refuses a file that is not markdown', async () => {
    expect(await resolveFile(path.join(loose, 'photo.png'), null, [])).toBe(null)
  })

  it('refuses a path that does not exist', async () => {
    expect(await resolveFile(path.join(vault, 'Missing.md'), vault, [])).toBe(null)
  })

  it('refuses a directory', async () => {
    expect(await resolveFile(nested, null, [])).toBe(null)
  })
})

describe('toRequest', () => {
  it('carries no question for a vault Lumina knows', () => {
    const request = toRequest({ path: 'a/b.md', vault: path.resolve('/vault'), unknown: false })
    expect(request).toEqual({ path: 'a/b.md', ask: null })
  })

  it('hands back the absolute file so the answer can be acted on', () => {
    const folder = path.resolve('/tmp/Loose')
    const request = toRequest({ path: 'Stray.md', vault: folder, unknown: true })
    expect(request.ask).toEqual({
      file: path.join(folder, 'Stray.md'),
      folder,
      name: 'Loose'
    })
  })
})
