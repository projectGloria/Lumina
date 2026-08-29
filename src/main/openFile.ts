/**
 * Opening a note the operating system handed us.
 *
 * Double-clicking a `.md` file, "Open with Lumina", or a path on the command
 * line all end up here. The file names a note, but Lumina works in vaults, so
 * the real question is which folder to open around it. In order of confidence:
 * the vault already on screen, a folder with a `.lumina` directory in it, a
 * vault the user has opened before, and only then the folder the file sits in
 * — which is a guess, so the renderer asks first.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileOpenRequest } from '@shared/types'
import {
  ancestorDirs,
  contains,
  isIgnored,
  isMarkdown,
  luminaDir,
  toRelative,
  vaultContaining
} from './paths'

/** A folder Lumina has opened before leaves a `.lumina` directory behind. */
async function isVaultDir(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(luminaDir(dir))).isDirectory()
  } catch {
    return false
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

export interface ResolvedFile {
  /** Vault-relative, forward-slash path of the note. */
  path: string
  /** Absolute folder to open as the vault. */
  vault: string
  /** True when nothing recognises the folder and the user should be asked. */
  unknown: boolean
}

/**
 * Work out which vault should open around `fileAbs`.
 *
 * Returns null for anything Lumina cannot show: a folder, a missing file, a
 * non-markdown file, or a note buried in a folder the indexer ignores.
 */
export async function resolveFile(
  fileAbs: string,
  currentRoot: string | null,
  recentVaults: string[]
): Promise<ResolvedFile | null> {
  if (!isMarkdown(fileAbs)) return null

  const abs = path.resolve(fileAbs)
  if (!(await isFile(abs))) return null

  const dir = path.dirname(abs)

  const from = (vault: string, unknown = false): ResolvedFile | null => {
    const rel = toRelative(vault, abs)
    // `.git`, `.lumina` and friends are never indexed, so a note inside one
    // could be opened but never saved back through the tree.
    return isIgnored(rel) ? null : { path: rel, vault, unknown }
  }

  // The vault already on screen, so the common case reopens nothing.
  if (currentRoot && contains(currentRoot, abs)) return from(path.resolve(currentRoot))

  // A real vault marker beats a guess; the deepest one wins.
  for (const candidate of ancestorDirs(dir)) {
    if (await isVaultDir(candidate)) return from(candidate)
  }

  // Failing that, somewhere the user has worked before.
  const known = vaultContaining(abs, recentVaults)
  if (known) return from(known)

  return from(dir, true)
}

/** Shape the renderer receives, so it can open the note or ask about the folder. */
export function toRequest(resolved: ResolvedFile): FileOpenRequest {
  return {
    path: resolved.path,
    ask: resolved.unknown
      ? { file: path.join(resolved.vault, resolved.path), folder: resolved.vault, name: path.basename(resolved.vault) }
      : null
  }
}
