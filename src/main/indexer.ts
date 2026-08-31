import fs from 'node:fs/promises'
import type { LinkRef, NoteIndexEntry, VaultIndex } from '@shared/types'
import { emptyIndex } from '@shared/types'
import { buildAliasMap, isPathAtOrBelow, parseNote, resolveLink } from '@shared/markdown-parse'
import { safeVaultPath } from './paths'
import { cacheFile, readJson, writeJson } from './settings'
import { getRoot, listNotes, requireRoot } from './vault'
import { loadSearch, removeDoc, resetSearch, serializeSearch, upsertDoc } from './search'

const CACHE_VERSION = 3

interface CacheShape {
  version: number
  notes: Record<string, NoteIndexEntry>
  search: string | null
}

/** Parsed entries for every note, keyed by vault-relative path. */
const notes = new Map<string, NoteIndexEntry>()

/** Snapshot handed to the renderer; rebuilt whenever links change. */
let snapshot: VaultIndex = emptyIndex()

let dirty = false
let revision = 0
let rebuilding: Promise<void> | null = null

function markDirty(): void {
  revision++
  dirty = true
}

export async function getIndex(): Promise<VaultIndex> {
  while (dirty) {
    rebuilding ??= rebuildSnapshot().finally(() => {
      rebuilding = null
    })
    await rebuilding
  }
  return snapshot
}

/* --------------------------------------------------------- link resolution */

/**
 * Re-resolve every link and recompute backlinks and tags.
 *
 * Resolution is global (a new note can satisfy links written months ago), so
 * this runs whole rather than incrementally. It is a pure in-memory pass over
 * already-parsed entries, cheap enough to do on every change.
 */
async function rebuildSnapshot(): Promise<void> {
  const startingRevision = revision
  const paths = [...notes.keys()]
  const aliases = buildAliasMap(notes.values())
  const next: VaultIndex = emptyIndex()

  let count = 0
  for (const [notePath, entry] of notes) {
    if (++count % 500 === 0) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    const links: LinkRef[] = entry.links.map((l) => ({
      ...l,
      to: resolveLink(l.target, notePath, paths, aliases)
    }))
    next.notes[notePath] = { ...entry, links }

    for (const tag of entry.tags) {
      ;(next.tags[tag] ??= []).push(notePath)
      // Nested tags roll up: `#project/gloria` also counts under `#project`.
      const parts = tag.split('/')
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/')
        const list = (next.tags[parent] ??= [])
        if (!list.includes(notePath)) list.push(notePath)
      }
    }

    for (const link of links) {
      if (link.to) (next.backlinks[link.to] ??= []).push(link)
      else if (link.kind === 'link') next.unresolved.push(link)
    }
  }

  snapshot = next
  // `setImmediate` above lets filesystem events run during a large rebuild.
  // If one changed the notes map, loop through a fresh rebuild rather than
  // declaring an inconsistent snapshot clean.
  dirty = revision !== startingRevision
}

/* ------------------------------------------------------------- maintenance */

async function statMtime(rel: string): Promise<number | null> {
  const abs = await safeVaultPath(requireRoot(), rel)
  if (!abs) return null
  try {
    return (await fs.stat(abs)).mtimeMs
  } catch {
    return null
  }
}

/** Read, parse and index one note. Returns false if it could not be read. */
export async function indexNote(rel: string): Promise<boolean> {
  const abs = await safeVaultPath(requireRoot(), rel)
  if (!abs) return false
  try {
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    const entry = parseNote(rel, content, stat.mtimeMs)
    notes.set(rel, entry)
    upsertDoc(rel, entry.title, entry.tags, content)
    markDirty()
    return true
  } catch {
    return false
  }
}

export function forgetNote(rel: string): void {
  if (notes.delete(rel)) {
    removeDoc(rel)
    markDirty()
  }
}

/**
 * Forget a folder and everything under it.
 *
 * A folder deleted outside the app can arrive as a lone `unlinkDir` with no
 * `unlink` for the notes inside it, which would otherwise leave them in the
 * index: ghosts in the switcher and backlinks pointing at files that are gone.
 */
export function forgetNotesUnder(rel: string): boolean {
  let changed = false
  for (const notePath of [...notes.keys()]) {
    if (!isPathAtOrBelow(notePath, rel)) continue
    notes.delete(notePath)
    removeDoc(notePath)
    changed = true
  }
  if (changed) markDirty()
  return changed
}

/* ------------------------------------------------------------------ build */

export interface BuildStats {
  total: number
  parsed: number
  reused: number
  ms: number
}

/**
 * Build the whole index, reusing the on-disk cache for files whose mtime has
 * not moved. A warm cache turns startup into one `stat` per note.
 */
export async function buildIndex(): Promise<BuildStats> {
  const started = Date.now()
  const vault = requireRoot()

  notes.clear()
  markDirty()
  resetSearch()

  const cache = await readJson<CacheShape>(cacheFile(vault), {
    version: CACHE_VERSION,
    notes: {},
    search: null
  })
  const usable = cache.version === CACHE_VERSION
  const searchLoaded = usable && cache.search ? loadSearch(cache.search) : false
  if (!searchLoaded) resetSearch()

  const paths = await listNotes()
  let parsed = 0
  let reused = 0

  for (const rel of paths) {
    const cached = usable ? cache.notes[rel] : undefined
    if (cached && searchLoaded) {
      const mtime = await statMtime(rel)
      if (mtime !== null && Math.abs(mtime - cached.mtime) < 1) {
        notes.set(rel, cached)
        markDirty()
        reused++
        continue
      }
    }
    if (await indexNote(rel)) parsed++
  }

  // Anything left in the cache but gone from disk must leave the search index.
  if (searchLoaded) {
    for (const stale of Object.keys(cache.notes)) {
      if (!notes.has(stale)) removeDoc(stale)
    }
  }

  markDirty()
  await getIndex()

  return { total: paths.length, parsed, reused, ms: Date.now() - started }
}

let saveTimer: NodeJS.Timeout | null = null

/** Persist the cache lazily; it is a speedup, never the source of truth. */
export function scheduleCacheSave(delay = 4000): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveCache()
  }, delay)
}

/** Drop a pending save, for a vault being closed or the app shutting down. */
export function cancelCacheSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}

export async function saveCache(): Promise<void> {
  // A timer can outlive the vault it was scheduled for; there is nothing to
  // write then, and `requireRoot` would throw into an unhandled rejection.
  const vault = getRoot()
  if (!vault) return

  const payload: CacheShape = {
    version: CACHE_VERSION,
    notes: Object.fromEntries(notes),
    search: serializeSearch()
  }
  try {
    await writeJson(cacheFile(vault), payload)
  } catch {
    // A cache we cannot write is not worth interrupting the user over.
  }
}
