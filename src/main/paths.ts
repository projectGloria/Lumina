import path from 'node:path'
import { normalizePath } from '@shared/markdown-parse'

/** Folders never shown in the file tree, indexed, or watched. */
export const IGNORED_DIRS = new Set(['.lumina', '.git', '.obsidian', 'node_modules', '.trash'])

export const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdx'])

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

/** Absolute path back to vault-relative, forward-slash form. */
export function toRelative(vaultRoot: string, absolute: string): string {
  return normalizePath(path.relative(path.resolve(vaultRoot), absolute))
}

export function isMarkdown(p: string): boolean {
  return MARKDOWN_EXT.has(path.extname(p).toLowerCase())
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
