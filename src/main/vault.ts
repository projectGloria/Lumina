import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type { FolderNode, OpResult, TreeNode, WriteResult } from '@shared/types'
import { basename, isMarkdownPath, normalizePath, stripExtension } from '@shared/markdown-parse'
import { isIgnored, isMarkdown, safeVaultPath, samePath, toRelative } from './paths'
import { ensureLuminaDir } from './settings'

/** Absolute path of the vault currently open, or null before one is chosen. */
let root: string | null = null

/**
 * Paths this process wrote in the last moment.
 *
 * The watcher fires on our own saves too; without this the renderer would get
 * told its buffer changed on disk every time it autosaved.
 */
const selfWrites = new Map<string, number>()
const SELF_WRITE_GRACE_MS = 1500

export function getRoot(): string | null {
  return root
}

export function requireRoot(): string {
  if (!root) throw new Error('No vault is open')
  return root
}

export async function setRoot(dir: string): Promise<void> {
  root = path.resolve(dir)
  await ensureLuminaDir(root)
}

export function markSelfWrite(absPath: string): void {
  selfWrites.set(path.resolve(absPath), Date.now())
}

/** True when the given absolute path was written by us moments ago. */
export function wasSelfWrite(absPath: string): boolean {
  const key = path.resolve(absPath)
  const at = selfWrites.get(key)
  if (at === undefined) return false
  if (Date.now() - at > SELF_WRITE_GRACE_MS) {
    selfWrites.delete(key)
    return false
  }
  return true
}

/* ------------------------------------------------------------------ tree */

/** Read the vault as a nested tree, folders first then files, both A-Z. */
export async function readTree(): Promise<TreeNode[]> {
  const vault = requireRoot()

  const walk = async (relDir: string): Promise<TreeNode[]> => {
    const absDir = path.join(vault, relDir)
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }

    const nodes: TreeNode[] = []
    const folderPromises: Promise<void>[] = []

    for (const entry of entries) {
      const rel = normalizePath(relDir ? `${relDir}/${entry.name}` : entry.name)
      if (isIgnored(rel) || entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        folderPromises.push(
          walk(rel).then((children) => {
            nodes.push({
              kind: 'folder',
              path: rel,
              name: entry.name,
              children
            } satisfies FolderNode)
          })
        )
      } else if (isMarkdown(entry.name)) {
        let stat
        try {
          stat = await fs.stat(path.join(absDir, entry.name))
        } catch {
          continue
        }
        nodes.push({
          kind: 'file',
          path: rel,
          name: entry.name,
          title: stripExtension(entry.name),
          mtime: stat.mtimeMs,
          createdAt: stat.birthtimeMs,
          size: stat.size
        })
      }
    }

    await Promise.all(folderPromises)

    return nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }

  return walk('')
}

/** Flat list of every markdown path in the vault. Used by the indexer. */
export async function listNotes(): Promise<string[]> {
  const out: string[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'folder') walk(n.children)
      else out.push(n.path)
    }
  }
  walk(await readTree())
  return out
}

/* ----------------------------------------------------------------- notes */

export async function readNote(rel: string): Promise<OpResult<{ content: string; mtime: number }>> {
  const abs = await safeVaultPath(requireRoot(), rel)
  if (!abs) return { ok: false, error: 'Path is outside the vault' }
  try {
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    return { ok: true, data: { content, mtime: stat.mtimeMs } }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Write a note atomically: a temp file next to the target, then a rename.
 * A crash mid-save leaves the previous version intact rather than a half file.
 */
export async function writeNote(rel: string, content: string): Promise<WriteResult> {
  const abs = await safeVaultPath(requireRoot(), rel, true)
  if (!abs) return { ok: false, mtime: 0, error: 'Path is outside the vault' }

  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${randomUUID()}.lumina-tmp`)
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true })
    markSelfWrite(abs)
    await fs.writeFile(tmp, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(tmp, abs)
    const stat = await fs.stat(abs)
    markSelfWrite(abs)
    return { ok: true, mtime: stat.mtimeMs }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    return { ok: false, mtime: 0, error: (err as Error).message }
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs)
    return true
  } catch {
    return false
  }
}

export async function noteExists(rel: string): Promise<boolean> {
  const abs = await safeVaultPath(requireRoot(), rel)
  return abs ? exists(abs) : false
}

/** Append ` 1`, ` 2`, ... until the name is free. */
async function uniquePath(abs: string): Promise<string> {
  if (!(await exists(abs))) return abs
  const dir = path.dirname(abs)
  const ext = path.extname(abs)
  const stem = path.basename(abs, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${stem} ${i}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  return path.join(dir, `${stem} ${Date.now()}${ext}`)
}

export async function createNote(rel: string, content = ''): Promise<OpResult<string>> {
  const vault = requireRoot()
  const wanted = await safeVaultPath(vault, isMarkdownPath(rel) ? rel : `${rel}.md`, true)
  if (!wanted) return { ok: false, error: 'Path is outside the vault' }

  try {
    const abs = await uniquePath(wanted)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    markSelfWrite(abs)
    await fs.writeFile(abs, content, 'utf8')
    return { ok: true, data: toRelative(vault, abs) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function createFolder(rel: string): Promise<OpResult<string>> {
  const vault = requireRoot()
  const abs = await safeVaultPath(vault, rel, true)
  if (!abs) return { ok: false, error: 'Path is outside the vault' }
  try {
    await fs.mkdir(abs, { recursive: true })
    return { ok: true, data: toRelative(vault, abs) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Rename or move a file or folder. Returns the new vault-relative path. */
export async function renamePath(from: string, to: string): Promise<OpResult<string>> {
  const vault = requireRoot()
  const absFrom = await safeVaultPath(vault, from)
  const absTo = await safeVaultPath(vault, to, true)
  if (!absFrom || !absTo) return { ok: false, error: 'Path is outside the vault' }
  if (absFrom === absTo) return { ok: true, data: normalizePath(to) }

  // `Note.md` -> `note.md` is a real rename, but on Windows the target already
  // "exists" because it is the same file. Skip the collision check for that
  // case or changing a name's capitalisation becomes impossible.
  const caseOnly = samePath(absFrom, absTo)

  try {
    if (!caseOnly && (await exists(absTo))) {
      return { ok: false, error: `"${basename(to)}" already exists` }
    }
    await fs.mkdir(path.dirname(absTo), { recursive: true })
    markSelfWrite(absFrom)
    markSelfWrite(absTo)
    await fs.rename(absFrom, absTo)
    return { ok: true, data: toRelative(vault, absTo) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Send to the OS recycle bin rather than deleting outright. */
export async function deletePath(rel: string): Promise<OpResult> {
  if (!rel) return { ok: false, error: 'The vault root cannot be deleted' }
  const abs = await safeVaultPath(requireRoot(), rel)
  if (!abs) return { ok: false, error: 'Path is outside the vault' }
  try {
    markSelfWrite(abs)
    await shell.trashItem(abs)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function revealInExplorer(rel: string): Promise<void> {
  const abs = await safeVaultPath(requireRoot(), rel)
  if (abs) shell.showItemInFolder(abs)
}

/* ----------------------------------------------------------- attachments */

/** Copy pasted or dropped binary data into the vault attachment folder. */
export async function saveAttachment(
  folder: string,
  name: string,
  data: ArrayBuffer
): Promise<OpResult<string>> {
  const vault = requireRoot()
  const target = await safeVaultPath(vault, `${folder}/${path.basename(name)}`, true)
  if (!target) return { ok: false, error: 'Path is outside the vault' }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    const abs = await uniquePath(target)
    markSelfWrite(abs)
    await fs.writeFile(abs, Buffer.from(data))
    return { ok: true, data: toRelative(vault, abs) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
