import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { OpResult } from '@shared/types'
import { isMarkdownPath } from '@shared/markdown-parse'
import { safeVaultPath, toRelative } from './paths'

/** Exclusive creation retries collisions without replacing an existing file. */
export async function writeExclusive(
  target: string,
  data: string | NodeJS.ArrayBufferView,
  encoding?: BufferEncoding,
  markSelfWrite: (file: string) => void = () => {}
): Promise<string> {
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const stem = path.basename(target, ext)
  await fs.mkdir(dir, { recursive: true })

  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? target : path.join(dir, `${stem} ${i}${ext}`)
    try {
      markSelfWrite(candidate)
      if (typeof data === 'string') {
        await fs.writeFile(candidate, data, { flag: 'wx', encoding: encoding ?? 'utf8' })
      } else {
        await fs.writeFile(candidate, data, { flag: 'wx' })
      }
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        continue
      }
      throw err
    }
  }

  const fallback = path.join(dir, `${stem} ${Date.now()}-${randomUUID().slice(0, 8)}${ext}`)
  markSelfWrite(fallback)
  if (typeof data === 'string') {
    await fs.writeFile(fallback, data, { flag: 'wx', encoding: encoding ?? 'utf8' })
  } else {
    await fs.writeFile(fallback, data, { flag: 'wx' })
  }
  return fallback
}

export async function createNoteAt(vault: string, rel: string, content = '', markSelfWrite: (file: string) => void = () => {}): Promise<OpResult<string>> {
  const wanted = await safeVaultPath(vault, isMarkdownPath(rel) ? rel : `${rel}.md`, true)
  if (!wanted) return { ok: false, error: 'Path is outside the vault' }

  try {
    const abs = await writeExclusive(wanted, content, 'utf8', markSelfWrite)
    return { ok: true, data: toRelative(vault, abs) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}


/** Write exactly the path approved by the native Save As dialog. */
export async function writeChosenNote(file: string, text: string): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.lumina-tmp`)
  try {
    await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, file)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}
