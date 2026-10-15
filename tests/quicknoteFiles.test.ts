/**
 * Quick Note as a file editor: the buffer model, and the read/write pair.
 *
 * The round-trip cases are the ones that matter. Saving a file must give back
 * the bytes it started with everywhere the user did not type — same endings,
 * same byte-order mark — because the alternative is an editor that rewrites
 * every line of a file it was only asked to change one line of.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_FILE_BYTES, readDocument, writeDocument } from '../src/main/quicknote/files'
import { draftTitle, isDirty, parseSession, type Draft } from '../src/shared/quicknoteSession'
import { encodeText } from '../src/shared/textFiles'

const dirs: string[] = []
async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-qnfiles-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

const draft = (over: Partial<Draft> = {}): Draft => ({
  id: 'a', createdAt: 1, updatedAt: 1, text: '', cursor: 0, ...over
})

describe('the buffer model', () => {
  it('still parses a cache written before files existed', () => {
    // Every file field is optional precisely so an upgrade does not strand
    // someone's drafts on an unreadable cache.
    const legacy = { version: 1, buffers: [{ id: 'x', createdAt: 1, updatedAt: 2, text: 'hi', cursor: 2 }] }
    expect(() => parseSession(legacy)).not.toThrow()
  })

  it('accepts a file-backed buffer', () => {
    const session = {
      version: 1,
      buffers: [draft({ filePath: 'C:/a/b.txt', savedText: 'on disk', text: 'on disk', eol: 'crlf', encoding: 'utf16le', bom: true })]
    }
    expect(() => parseSession(session)).not.toThrow()
  })

  it('refuses a buffer whose file fields are the wrong shape', () => {
    for (const bad of [
      { filePath: 42 },
      { savedText: [] },
      { eol: 'cr' },
      { encoding: 'latin1' },
      { bom: 'yes' }
    ]) {
      expect(() => parseSession({ version: 1, buffers: [draft(bad as Partial<Draft>)] })).toThrow()
    }
  })

  it('calls a file modified only when it differs from disk', () => {
    expect(isDirty(draft({ filePath: 'a.txt', savedText: 'same', text: 'same' }))).toBe(false)
    expect(isDirty(draft({ filePath: 'a.txt', savedText: 'same', text: 'edited' }))).toBe(true)
  })

  it('calls any typed-in scratch draft modified, since it has no disk state', () => {
    expect(isDirty(draft({ text: '' }))).toBe(false)
    expect(isDirty(draft({ text: 'typed' }))).toBe(true)
  })

  it('names a tab after its file, and an untitled one by position', () => {
    expect(draftTitle(draft({ filePath: 'C:\\Users\\me\\notes.txt' }), 0)).toBe('notes.txt')
    expect(draftTitle(draft({ filePath: '/home/me/a.md' }), 3)).toBe('a.md')
    expect(draftTitle(draft(), 2)).toBe('new 3')
  })
})

describe('reading a file', () => {
  it('reads plain text and reports LF', async () => {
    const dir = await temp()
    const file = path.join(dir, 'a.txt')
    await fs.writeFile(file, 'one\ntwo', 'utf8')

    const result = await readDocument(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.text).toBe('one\ntwo')
    expect(result.doc.eol).toBe('lf')
    expect(result.doc.encoding).toBe('utf8')
    expect(result.doc.bom).toBe(false)
  })

  it('normalises CRLF for the editor but remembers the file uses it', async () => {
    const dir = await temp()
    const file = path.join(dir, 'win.txt')
    await fs.writeFile(file, 'one\r\ntwo\r\n', 'utf8')

    const result = await readDocument(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.text).toBe('one\ntwo\n')
    expect(result.doc.eol).toBe('crlf')
  })

  it('refuses a binary file with a reason rather than opening gibberish', async () => {
    const dir = await temp()
    const file = path.join(dir, 'a.bin')
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]))

    const result = await readDocument(file)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not text/i)
  })

  it('refuses a file too large for a textarea, and says how large', async () => {
    const dir = await temp()
    const file = path.join(dir, 'huge.log')
    await fs.writeFile(file, Buffer.alloc(MAX_FILE_BYTES + 1024, 0x61))

    const result = await readDocument(file)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/MB/)
  })

  it('reports a missing file and a folder without throwing', async () => {
    const dir = await temp()
    const missing = await readDocument(path.join(dir, 'nope.txt'))
    expect(missing.ok).toBe(false)

    const folder = await readDocument(dir)
    expect(folder.ok).toBe(false)
    if (folder.ok) return
    expect(folder.error).toMatch(/folder/i)
  })
})

describe('writing a file back', () => {
  it('restores CRLF, so an untouched Windows file is byte-identical', async () => {
    const dir = await temp()
    const file = path.join(dir, 'win.txt')
    const original = 'alpha\r\nbeta\r\ngamma'
    await fs.writeFile(file, original, 'utf8')

    const read = await readDocument(file)
    expect(read.ok).toBe(true)
    if (!read.ok) return

    // Save with nothing changed — the file must come back exactly as it was.
    await writeDocument(file, read.doc.text, read.doc.eol, read.doc.encoding, read.doc.bom)
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('keeps a UTF-8 byte-order mark across a save', async () => {
    const dir = await temp()
    const file = path.join(dir, 'bom.txt')
    await fs.writeFile(file, Buffer.from(encodeText('hello\r\n', 'utf8', true)))

    const read = await readDocument(file)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.doc.bom).toBe(true)
    expect(read.doc.text).toBe('hello\n')

    await writeDocument(file, read.doc.text, read.doc.eol, read.doc.encoding, read.doc.bom)
    const bytes = await fs.readFile(file)
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('keeps a UTF-16 file in UTF-16 rather than silently converting it', async () => {
    const dir = await temp()
    const file = path.join(dir, 'utf16.txt')
    await fs.writeFile(file, Buffer.from(encodeText('héllo\r\nthere', 'utf16le', true)))

    const read = await readDocument(file)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.doc.encoding).toBe('utf16le')
    expect(read.doc.text).toBe('héllo\nthere')

    await writeDocument(file, read.doc.text + '!', read.doc.eol, read.doc.encoding, read.doc.bom)
    const reread = await readDocument(file)
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.doc.encoding).toBe('utf16le')
    expect(reread.doc.text).toBe('héllo\nthere!')
  })

  it('creates a file that does not exist yet, for Save As', async () => {
    const dir = await temp()
    const file = path.join(dir, 'brand new.md')
    await writeDocument(file, 'first\nsecond', 'lf', 'utf8', false)
    expect(await fs.readFile(file, 'utf8')).toBe('first\nsecond')
  })

  it('leaves no temporary file behind', async () => {
    const dir = await temp()
    const file = path.join(dir, 'a.txt')
    await writeDocument(file, 'content', 'lf', 'utf8', false)
    const listed = await fs.readdir(dir)
    expect(listed).toEqual(['a.txt'])
  })

  it('writes through a symlink instead of replacing it', async () => {
    const dir = await temp()
    const real = path.join(dir, 'real.txt')
    const link = path.join(dir, 'link.txt')
    await fs.writeFile(real, 'before', 'utf8')
    try {
      await fs.symlink(real, link)
    } catch {
      // Creating a symlink needs privilege on Windows; nothing to assert here
      // on a machine without it.
      return
    }

    await writeDocument(link, 'after', 'lf', 'utf8', false)
    // The rename would otherwise drop a regular file over the link and detach
    // it from its target, which is not what saving a file means.
    expect(await fs.readFile(real, 'utf8')).toBe('after')
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
  })
})
