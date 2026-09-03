/**
 * Pulling a clipped page's images into the vault.
 *
 * A clip that still points at the original server stops being a note the moment
 * the page changes or goes away, and it leaks a request to that server every
 * time the note is opened. Copying the bytes in is what makes a clip an actual
 * local document — and it keeps the renderer's CSP as tight as it is, since the
 * image then comes from `lumina://` like every other attachment.
 *
 * The renderer decides *which* images (it has the parsed document); this only
 * fetches and writes, because the renderer must never touch `fs`.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isHttp, fetchWithTimeout, readCapped, IMAGE_EXTENSIONS } from './net'
import { safeVaultPath, toRelative } from './paths'
import { getRoot, markSelfWrite } from './vault'

/** One clipped image. Generous enough for a hero shot, not for a video still. */
const IMAGE_BYTE_CAP = 8 * 1024 * 1024

/**
 * Fetch one image into `folder` and return its vault-relative path.
 *
 * Returns null on every failure rather than throwing: one dead image should
 * cost that image, never the clip. The name is a hash of the source URL, so
 * clipping the same page twice does not accumulate copies and two pages sharing
 * an image share the file.
 */
export async function saveClipImage(folder: string, url: string): Promise<string | null> {
  const vault = getRoot()
  if (!vault || !isHttp(url)) return null

  try {
    const response = await fetchWithTimeout(url, { accept: 'image/*' })
    if (!response.ok) return null

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const extension = IMAGE_EXTENSIONS[type]
    // Only types we can name. An unknown one is far more likely to be an error
    // page than an image, and writing it would produce a broken embed.
    if (!extension) return null

    const bytes = await readCapped(response, IMAGE_BYTE_CAP)
    if (!bytes.length) return null

    const name = `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.${extension}`
    // `folder` came from settings, so it goes through the same guard as any
    // other path the renderer can influence.
    const target = await safeVaultPath(vault, `${folder}/${name}`, true)
    if (!target) return null

    await fs.mkdir(path.dirname(target), { recursive: true })
    markSelfWrite(target)
    await fs.writeFile(target, bytes)
    return toRelative(vault, target)
  } catch {
    return null
  }
}
