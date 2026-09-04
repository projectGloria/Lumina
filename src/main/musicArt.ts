/**
 * Cover art out of the files themselves.
 *
 * The sidecar `cover.jpg` beside a track describes a *folder*, which is right
 * for an album and a lie for anything else — in a mixed library it puts one
 * record's sleeve on a dozen unrelated tracks, which is worse than no picture
 * because it asserts something false. The tags know better, so this asks them.
 *
 * Three things keep that affordable:
 *
 * - **Lazy, and never at boot.** `music-metadata` is `import()`ed on the first
 *   request and not before, so it is off the startup path and out of the
 *   bundle. Nothing is extracted during the library walk — only for tracks
 *   actually being drawn or played.
 * - **Downscaled.** Measured on this library: 44 tracks carry 68 MB of art
 *   between them, one of them a 5016x5016 PNG of 27.4 MB, all of it drawn at
 *   56px. Electron's own `nativeImage` takes that one to a 25 KB JPEG, so the
 *   cache is small without another dependency.
 * - **Cached by path and mtime.** A second play is a `stat` and a URL.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import { getMusicRoot } from './music'
import { safePathUnder } from './paths'

/** Widest a cached cover is stored at. The largest it is ever drawn is 56px. */
const ART_MAX = 320

/** Good enough for a sleeve at this size, and a fraction of the bytes. */
const ART_QUALITY = 82

/**
 * What has been looked up this session, including the misses.
 *
 * A track with no embedded art would otherwise be re-parsed every time its row
 * scrolled back into view. Hits are on disk as well; misses are only worth
 * remembering for as long as the library does.
 */
const seen = new Map<string, string | null>()

/** Requests in flight, so a row drawn twice does not parse the file twice. */
const inFlight = new Map<string, Promise<string | null>>()

export const artCacheDir = (): string => path.join(app.getPath('userData'), 'musicart')

/** Stable per file *and* per edit: retagging a track re-extracts it. */
function cacheKey(rel: string, mtimeMs: number): string {
  return createHash('sha1').update(`${rel}:${Math.round(mtimeMs)}`).digest('hex').slice(0, 20)
}

/**
 * The cached cover for a track, as a file name under `artCacheDir`, or null
 * when the file carries none.
 *
 * Null is an answer, not a failure: the renderer falls back to the folder's
 * sidecar and then to a generated tile.
 */
export async function trackArt(rel: string): Promise<string | null> {
  const root = getMusicRoot()
  if (!root) return null

  const abs = await safePathUnder(root, rel)
  if (!abs) return null

  let mtimeMs: number
  try {
    mtimeMs = (await fs.stat(abs)).mtimeMs
  } catch {
    return null
  }

  const key = cacheKey(rel, mtimeMs)
  const cached = seen.get(key)
  if (cached !== undefined) return cached

  const running = inFlight.get(key)
  if (running) return running

  const work = extract(abs, key)
    .then((result) => {
      seen.set(key, result)
      return result
    })
    .catch(() => {
      // A file that cannot be parsed has no art as far as anyone drawing it is
      // concerned, and saying so once is better than trying on every scroll.
      seen.set(key, null)
      return null
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, work)
  return work
}

async function extract(abs: string, key: string): Promise<string | null> {
  const dir = artCacheDir()
  const name = `${key}.jpg`
  const file = path.join(dir, name)

  // Written by an earlier session: a second play costs a `stat`.
  try {
    await fs.access(file)
    return name
  } catch {
    // Not cached yet.
  }

  // Imported here rather than at the top of the file: this is the only reason
  // the dependency exists, and a library nobody opens should never load it.
  const { parseFile } = await import('music-metadata')
  const meta = await parseFile(abs, { duration: false })
  const picture = meta.common.picture?.[0]
  if (!picture?.data?.length) return null

  const raw = Buffer.from(picture.data)
  let bytes: Buffer = raw
  try {
    const image = nativeImage.createFromBuffer(raw)
    const size = image.getSize()
    if (!image.isEmpty() && size.width > ART_MAX) {
      bytes = image.resize({ width: ART_MAX, quality: 'good' }).toJPEG(ART_QUALITY)
    } else if (!image.isEmpty()) {
      bytes = image.toJPEG(ART_QUALITY)
    }
  } catch {
    // An image Chromium will not decode is written through as it came; the
    // renderer either draws it or falls back, and neither is worth failing for.
  }

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, bytes)
  return name
}

/** Forget everything remembered about a folder that is no longer the one. */
export function resetArtCache(): void {
  seen.clear()
  inFlight.clear()
}
