/**
 * Reading and writing the files Quick Note now opens.
 *
 * Quick Note has no vault, so none of `paths.ts` applies here — the user
 * double-clicked this file and is entitled to edit it wherever it lives. What
 * replaces the vault guard is a pair of much simpler refusals: a file bigger
 * than a textarea can carry, and a file that is not text at all. Both fail with
 * a sentence the status bar can show, because a window that silently stays
 * empty is the worst version of either.
 *
 * The decoding rules themselves live in `@shared/textFiles` and are tested
 * there; this file is the `fs` half.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  decodeText,
  detectEol,
  encodeText,
  fromEditorText,
  looksBinary,
  toEditorText,
  type Encoding,
  type Eol
} from '@shared/textFiles'
import type { FileOpenResult } from '@shared/quicknoteSession'

/**
 * Past this a `<textarea>` stops being an editor and starts being a hang.
 *
 * Notepad++ opens far larger files because it does not keep the whole document
 * in one DOM node; refusing with a clear message is the honest version of what
 * this editor can actually do.
 */
export const MAX_FILE_BYTES = 16 * 1024 * 1024

/** Enough of the head to judge whether the rest is worth decoding. */
const SNIFF_BYTES = 8192

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return 'That file no longer exists.'
  if (code === 'EACCES' || code === 'EPERM') return 'That file is not readable.'
  if (code === 'EISDIR') return 'That is a folder, not a file.'
  return (error as Error)?.message ?? String(error)
}

/**
 * Read one file into something a tab can hold.
 *
 * Never throws: every failure comes back as a result the renderer can put in
 * front of the user, because these paths arrive from the OS and a bad one is an
 * ordinary Tuesday, not an exception.
 */
export async function readDocument(filePath: string): Promise<FileOpenResult> {
  const abs = path.resolve(filePath)
  try {
    const stat = await fs.stat(abs)
    if (stat.isDirectory()) return { ok: false, path: abs, error: 'That is a folder, not a file.' }
    if (!stat.isFile()) return { ok: false, path: abs, error: 'That is not a regular file.' }
    if (stat.size > MAX_FILE_BYTES) {
      const mb = (stat.size / (1024 * 1024)).toFixed(1)
      return {
        ok: false,
        path: abs,
        error: `That file is ${mb} MB — Quick Note opens files up to ${MAX_FILE_BYTES / (1024 * 1024)} MB.`
      }
    }

    const bytes = new Uint8Array(await fs.readFile(abs))
    if (looksBinary(bytes.subarray(0, SNIFF_BYTES))) {
      return { ok: false, path: abs, error: 'That file is not text.' }
    }

    const decoded = decodeText(bytes)
    // The ending is read off the raw text and remembered before normalising,
    // because after `toEditorText` there is nothing left to detect.
    const eol = detectEol(decoded.text)
    return {
      ok: true,
      doc: {
        path: abs,
        text: toEditorText(decoded.text),
        eol,
        encoding: decoded.encoding,
        bom: decoded.bom
      }
    }
  } catch (error) {
    return { ok: false, path: abs, error: describe(error) }
  }
}

/** Read several, in order, keeping a failure alongside the ones that worked. */
export async function readDocuments(paths: string[]): Promise<FileOpenResult[]> {
  const out: FileOpenResult[] = []
  for (const file of paths) out.push(await readDocument(file))
  return out
}

/**
 * Write editor text back to a path, in the file's own encoding and endings.
 *
 * Through a temporary file and a rename, so an interrupted write cannot leave a
 * half-saved document where a whole one used to be. The target is realpath'd
 * first: renaming onto a symlink would replace the *link* with a regular file
 * and quietly detach it from whatever it pointed at, which is not what saving
 * a file means.
 */
export async function writeDocument(
  filePath: string,
  text: string,
  eol: Eol,
  encoding: Encoding,
  bom: boolean,
  expected?: string | null
): Promise<void> {
  let target = path.resolve(filePath)
  try {
    target = await fs.realpath(target)
  } catch {
    // Not there yet — a Save As to a new name. The chosen path is the target.
  }

  const bytes = encodeText(fromEditorText(text, eol), encoding, bom)
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.lumina-tmp`
  )
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    if (expected !== undefined) {
      const disk = await readDocument(target)
      if (!disk.ok || disk.doc.text !== expected) throw new Error('This file changed or was removed on disk. Use Save As to save a recovery copy, or reopen the disk version.')
    }
    await fs.rename(temporary, target)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}
