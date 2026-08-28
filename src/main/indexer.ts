import fs from 'node:fs/promises'
import type { LinkRef, NoteIndexEntry, VaultIndex } from '@shared/types'
import { emptyIndex } from '@shared/types'
import { buildAliasMap, parseNote, resolveLink } from '@shared/markdown-parse'
import { safeJoin } from './paths'
import { cacheFile, readJson, writeJson } from './settings'
import { listNotes, requireRoot } from './vault'
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

export function getIndex(): VaultIndex {
  if (dirty) rebuildSnapshot()
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
function rebuildSnapshot(): void {
  const paths = [...notes.keys()]
  const aliases = buildAliasMap(notes.values())
  const next: VaultIndex = emptyIndex()

  for (const [notePath, entry] of notes) {
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
  dirty = false
}

/* ------------------------------------------------------------- maintenance */

async function statMtime(rel: string): Promise<number | null> {
  const abs = safeJoin(requireRoot(), rel)
  if (!abs) return null
  try {
    return (await fs.stat(abs)).mtimeMs
  } catch {
    return null
  }
}

/** Read, parse and index one note. Returns false if it could not be read. */
export async function indexNote(rel: string): Promise<boolean> {
  const abs = safeJoin(requireRoot(), rel)
  if (!abs) return false
  try {
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    const entry = parseNote(rel, content, stat.mtimeMs)
    notes.set(rel, entry)
    upsertDoc(rel, entry.title, entry.tags, content)
    dirty = true
    return true
  } catch {
    return false
  }
}

export function forgetNote(rel: string): void {
  if (notes.delete(rel)) {
    removeDoc(rel)
    dirty = true
  }
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

  dirty = true
  rebuildSnapshot()

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

export async function saveCache(): Promise<void> {
  const vault = requireRoot()
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
