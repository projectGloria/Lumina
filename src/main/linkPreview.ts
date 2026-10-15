/**
 * Optional metadata for link banners.
 *
 * Lumina is otherwise entirely offline — nothing is fetched at runtime — so
 * this only ever runs when the user turns "fetch link previews" on. The
 * renderer draws a perfectly good card without it; this just fills in the
 * title, description and thumbnail the page publishes about itself.
 *
 * Everything here is deliberately narrow: http(s) only, one small ranged read
 * rather than a whole page, images capped and stored inside the vault so they
 * are served by the existing `lumina://` scheme instead of widening the CSP.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseOgTags, type LinkMetadata } from '@shared/linkPreview'
import { fetchWithTimeout, isHttp, isPubliclyRoutable, readCapped, IMAGE_EXTENSIONS } from './net'
import { luminaDir, previewRel, readJson, writeJson } from './settings'
import { safePathUnder } from './paths'
import { getRoot } from './vault'

/** Bump when `LinkMetadata` changes shape, so stale entries are re-fetched. */
const CACHE_VERSION = 2
/** A month: long enough to be a cache, short enough that a page can change. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const HTML_BYTE_CAP = 512 * 1024
const IMAGE_BYTE_CAP = 2 * 1024 * 1024

interface CacheShape {
  version: number
  entries: Record<string, LinkMetadata>
}

const cacheFile = (vault: string): string => path.join(luminaDir(vault), 'linkcache.json')

let cache: CacheShape | null = null
let cacheVault: string | null = null

async function loadCache(vault: string): Promise<CacheShape> {
  if (cache && cacheVault === vault) return cache
  const loaded = await readJson<CacheShape>(cacheFile(vault), { version: CACHE_VERSION, entries: {} })
  cache = loaded.version === CACHE_VERSION ? loaded : { version: CACHE_VERSION, entries: {} }
  cacheVault = vault
  return cache
}

let saving: Promise<void> = Promise.resolve()

function saveCache(vault: string): void {
  const snapshot = cache
  if (!snapshot) return
  saving = saving.catch(() => {}).then(() => writeJson(cacheFile(vault), snapshot))
}

/** Everything in flight, so ten notes referencing one URL fetch it once. */
const inFlight = new Map<string, Promise<LinkMetadata | null>>()

/**
 * Cache a preview image inside the vault.
 *
 * Downloading it rather than pointing the card at the remote URL keeps the
 * renderer's CSP as tight as it is: images come from `lumina://` and nothing
 * else. Failure is fine — the card just goes without a thumbnail.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function cacheImage(vault: string, imageUrl: string): Promise<string | undefined> {
  if (!isHttp(imageUrl) || !(await isPubliclyRoutable(imageUrl))) return undefined
  try {
    const response = await fetchWithTimeout(imageUrl, {
      'user-agent': BROWSER_UA,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    })
    if (!response.ok) return undefined

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const extension = IMAGE_EXTENSIONS[type]
    if (!extension) return undefined

    const bytes = await readCapped(response, IMAGE_BYTE_CAP)
    if (!bytes.length) return undefined

    const name = `${createHash('sha256').update(imageUrl).digest('hex').slice(0, 32)}.${extension}`
    // One constant behind all three of these, so the directory that gets
    // created, the file that gets written and the path the renderer is handed
    // can no longer disagree.
    const safeTarget = await safePathUnder(vault, previewRel(name), true)
    if (!safeTarget) return undefined
    await fs.mkdir(path.dirname(safeTarget), { recursive: true })
    await fs.writeFile(safeTarget, bytes)
    return previewRel(name)
  } catch {
    return undefined
  }
}

async function fetchMetadata(vault: string, url: string): Promise<LinkMetadata | null> {
  try {
    const response = await fetchWithTimeout(url, {
      'user-agent': BROWSER_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9'
    })
    if (!response.ok) return null

    const type = (response.headers.get('content-type') ?? '').toLowerCase()
    if (type && !type.includes('html')) return null

    const bytes = await readCapped(response, HTML_BYTE_CAP)
    const tags = parseOgTags(new TextDecoder('utf-8').decode(bytes))

    const pageUrl = new URL(response.url || url)
    const imagePath = tags.image
      ? await cacheImage(vault, new URL(tags.image, pageUrl).toString())
      : await cacheImage(vault, new URL('/favicon.ico', pageUrl.origin).toString())

    return { ...tags, imagePath, fetchedAt: Date.now() }
  } catch {
    return null
  }
}

/**
 * Metadata for one URL: from the vault's cache when it is there and fresh,
 * from the network otherwise. Returns null when there is nothing to add, which
 * the renderer treats as "draw the plain card".
 */
export async function linkPreview(url: string, refresh = false): Promise<LinkMetadata | null> {
  const vault = getRoot()
  if (!vault || !isHttp(url)) return null

  // Any URL in any note is a candidate, and a note may have been written by
  // someone else (a clip, a synced vault, a shared folder). Refusing private
  // and loopback addresses keeps "fetch link previews" from turning into a
  // probe of the user's own network, with the page title as the oracle.
  if (!(await isPubliclyRoutable(url))) return null

  const store = await loadCache(vault)
  const cached = store.entries[url]
  if (!refresh && cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached

  const existing = inFlight.get(url)
  if (existing) return existing

  const work = fetchMetadata(vault, url)
    .then((result) => {
      if (result) {
        store.entries[url] = result
        saveCache(vault)
      }
      return result ?? cached ?? null
    })
    .finally(() => inFlight.delete(url))

  inFlight.set(url, work)
  return work
}

/** Drop the in-memory cache when the vault changes; the file stays behind. */
export function forgetLinkPreviews(): void {
  cache = null
  cacheVault = null
  inFlight.clear()
}
