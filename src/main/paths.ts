import fs from 'node:fs/promises'
import path from 'node:path'
import { isMarkdownPath, normalizePath } from '@shared/markdown-parse'

/** Folders never shown in the file tree, indexed, or watched. */
export const IGNORED_DIRS = new Set(['.lumina', '.git', '.obsidian', 'node_modules', '.trash'])

/** Where a vault keeps everything Lumina knows about it. All of it rebuildable. */
export const luminaDir = (vault: string): string => path.join(vault, '.lumina')

/**
 * Resolve a vault-relative path to an absolute one, refusing anything that
 * escapes the vault root.
 *
 * The renderer never sees absolute paths, so every path crossing IPC runs
 * through here. A malicious or malformed link target like `../../../secrets`
 * gets rejected instead of reaching `fs`.
 */
export function safeJoin(vaultRoot: string, relative: string): string | null {
  if (typeof relative !== 'string') return null
  const rel = normalizePath(relative)
  if (rel.includes('\0')) return null

  const root = path.resolve(vaultRoot)
  const abs = path.resolve(root, rel)

  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

/**
 * Resolve a vault path and verify its real filesystem location.
 *
 * `safeJoin` prevents `..` traversal, but an in-vault symlink can still point
 * elsewhere. Existing targets are checked with `realpath`; for a new target,
 * its nearest existing parent is checked before creation.
 */
export async function safeVaultPath(
  vaultRoot: string,
  relative: string,
  allowMissing = false
): Promise<string | null> {
  const abs = safeJoin(vaultRoot, relative)
  if (!abs) return null

  let realRoot: string
  try {
    realRoot = await fs.realpath(path.resolve(vaultRoot))
  } catch {
    return null
  }

  let existing = abs
  for (;;) {
    try {
      const real = await fs.realpath(existing)
      if (!allowMissing && existing !== abs) return null
      return contains(realRoot, real) ? abs : null
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null
      if (!allowMissing) return null
      const parent = path.dirname(existing)
      if (parent === existing) return null
      existing = parent
    }
  }
}

/** Absolute path back to vault-relative, forward-slash form. */
export function toRelative(vaultRoot: string, absolute: string): string {
  return normalizePath(path.relative(path.resolve(vaultRoot), absolute))
}

export function isMarkdown(p: string): boolean {
  return isMarkdownPath(p)
}

/** True when any path segment is an ignored or hidden folder. */
export function isIgnored(relPath: string): boolean {
  return normalizePath(relPath)
    .split('/')
    .some((seg) => IGNORED_DIRS.has(seg) || (seg.startsWith('.') && seg !== '.'))
}

/** Turn a user-supplied note title into a safe file name. */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 200) || 'Untitled'
  )
}

/* ------------------------------------------------- files opened by the OS */

/**
 * Note paths passed on the command line, e.g. by double-clicking a `.md` file.
 *
 * Electron shifts argv by one when the app is not packaged, because the app
 * directory sits between the binary and the real arguments. Switches are
 * dropped so Chromium's own flags never look like a file.
 */
export function fileArgsFrom(argv: string[], packaged: boolean): string[] {
  return argv.slice(packaged ? 1 : 2).filter((arg) => !!arg && !arg.startsWith('-') && isMarkdown(arg))
}

/** Every directory from `dir` up to the filesystem root, deepest first. */
export function ancestorDirs(dir: string): string[] {
  const out: string[] = []
  let current = path.resolve(dir)
  for (;;) {
    out.push(current)
    const parent = path.dirname(current)
    if (parent === current) return out
    current = parent
  }
}

/** Windows paths differ only by case, so compare them folded there. */
const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)

/** True when two absolute paths point at the same place. */
export function samePath(a: string, b: string): boolean {
  return fold(path.resolve(a)) === fold(path.resolve(b))
}

/** True when `file` sits inside `root` (or is `root` itself). */
export function contains(root: string, file: string): boolean {
  const r = fold(path.resolve(root))
  const f = fold(path.resolve(file))
  return f === r || f.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

/**
 * The most specific of `vaults` containing `file`, or null.
 *
 * Deepest wins so a vault nested inside another still claims its own notes.
 */
export function vaultContaining(file: string, vaults: string[]): string | null {
  let best: string | null = null
  for (const vault of vaults) {
    if (!contains(vault, file)) continue
    const root = path.resolve(vault)
    if (!best || root.length > best.length) best = root
  }
  return best
}
