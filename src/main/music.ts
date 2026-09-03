/**
 * The music folder: where it is, and what is in it.
 *
 * A folder of music is not a vault. It is never indexed, never watched, never
 * shown in the explorer, and nothing here runs at startup — the walk below
 * happens when the player is first opened and not before. Lumina is meant to
 * come up into the tray with no vault indexed and answer a global shortcut on
 * the first press, and a twenty-thousand-file walk has no business on that
 * path.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { coverRank, isAudioPath } from '@shared/music'
import type { MusicListing, MusicTrack } from '@shared/types'
import { IGNORED_DIRS, toRelative } from './paths'

/**
 * Where the music is, mirrored from app-level settings.
 *
 * Module-level for the same reason the vault root is: the protocol handler
 * needs it to answer a request, and threading it through would mean the
 * renderer telling main where to read from, which is the thing the guard
 * exists to prevent.
 */
let root: string | null = null

export function setMusicRoot(dir: string | null): void {
  root = dir && dir.trim() ? path.resolve(dir) : null
}

export function getMusicRoot(): string | null {
  return root
}

/**
 * Most tracks a listing will return.
 *
 * Enough for a real library, bounded enough that the walk, the IPC payload and
 * the renderer's search over it all stay cheap. Past it the listing stops and
 * says so, rather than quietly returning a prefix.
 */
export const MUSIC_LIMIT = 20_000

/** Deepest folder nesting walked, so a pathological tree cannot run forever. */
const MAX_DEPTH = 12

/** Entries between yields, so a large library does not block the main process. */
const YIELD_EVERY = 200

/**
 * Every playable file under the music folder.
 *
 * `ok: false` is the case worth caring about: the folder is on an external
 * drive or a network share as often as not, and "unplugged" has to be
 * distinguishable from "empty" — one is a cable, the other is a library
 * nobody has filled. The renderer draws them differently and neither is a
 * toast.
 */
export async function listMusic(): Promise<MusicListing> {
  const base = root
  if (!base) return { ok: true, root: null, tracks: [], truncated: false }

  try {
    const stat = await fs.stat(base)
    if (!stat.isDirectory()) return { ok: false, root: base, tracks: [], truncated: false }
  } catch {
    // ENOENT, but also the drive being absent and the share being unreachable.
    return { ok: false, root: base, tracks: [], truncated: false }
  }

  const tracks: MusicTrack[] = []
  let truncated = false
  let seen = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_DEPTH) return

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // A folder that cannot be read is skipped rather than failing the walk:
      // one unreadable album should not cost someone their whole library.
      return
    }

    // The cover for this folder, found in the same pass rather than in a second
    // one: the artwork beside a track is the commonest case by far.
    let cover: string | null = null
    let bestRank = Infinity
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const rank = coverRank(entry.name)
      if (rank >= 0 && rank < bestRank) {
        bestRank = rank
        cover = toRelative(base, path.join(dir, entry.name))
      }
    }

    const dirs: string[] = []
    for (const entry of entries) {
      if (truncated) return
      if (++seen % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve))

      // `isDirectory` and `isFile` are both false for a symlink, so a link
      // loop cannot be walked into and a linked file is not served.
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
        dirs.push(path.join(dir, entry.name))
        continue
      }
      if (!entry.isFile() || !isAudioPath(entry.name)) continue

      if (tracks.length >= MUSIC_LIMIT) {
        truncated = true
        return
      }

      const abs = path.join(dir, entry.name)
      const info = await fs.stat(abs).catch(() => null)
      if (!info) continue
      tracks.push({
        path: toRelative(base, abs),
        size: info.size,
        mtime: info.mtimeMs,
        ...(cover ? { cover } : {})
      })
    }

    for (const child of dirs) await walk(child, depth + 1)
  }

  await walk(base, 0)
  tracks.sort((a, b) => a.path.localeCompare(b.path))
  return { ok: true, root: base, tracks, truncated }
}
