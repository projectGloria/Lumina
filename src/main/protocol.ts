import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { getMusicRoot } from './music'
import { artCacheDir } from './musicArt'
import { safePathUnder } from './paths'
import { contentRange, parseByteRange } from './range'
import { getRoot } from './vault'

/**
 * A custom scheme for reading files out of the open vault.
 *
 * The renderer is served over http in development and file in production, so
 * it cannot load an image sitting next to a note directly, and widening the
 * CSP to allow `file:` would open the whole disk. This serves exactly one
 * folder, and `safeJoin` rejects anything that tries to climb out of it.
 *
 * Images are addressed as `lumina://vault/<vault-relative path>`, audio from
 * the music folder as `lumina://music/<music-relative path>`, and cover art
 * lifted out of a track's tags as `lumina://art/<cache file>`. The music
 * folder is not a vault and is never indexed or watched, but it is served
 * under exactly the same guard: `safePathUnder` realpaths the result, so a
 * symlink planted in someone's album cannot read the rest of the disk.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'lumina',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function handleProtocol(): void {
  protocol.handle('lumina', async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const root =
      url.hostname === 'vault'
        ? getRoot()
        : url.hostname === 'music'
          ? getMusicRoot()
          : // Cover art lifted out of the tags, cached under `userData` rather
            // than in anyone's music folder — it is ours, and it is disposable.
            url.hostname === 'art'
            ? artCacheDir()
            : undefined
    if (root === undefined) return new Response('Not found', { status: 404 })
    if (!root) return new Response('Nothing to serve', { status: 404 })

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const abs = await safePathUnder(root, rel)
    if (!abs) return new Response('Forbidden', { status: 403 })

    const fileUrl = pathToFileURL(abs).toString()
    const wanted = request.headers.get('range')

    // No `Range`, which is every image the vault serves: unchanged, one fetch,
    // whole body.
    if (!wanted) {
      try {
        return await net.fetch(fileUrl)
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }

    /*
     * A ranged request, which is how an `<audio>` element seeks.
     *
     * Measured, not assumed: `net.fetch` on a `file:` URL *does* honour a
     * forwarded `Range` and returns exactly the bytes asked for — but it
     * answers `200` with no `Content-Range` and no `Accept-Ranges`. A 200
     * carrying a hundred bytes tells the player the whole file is a hundred
     * bytes long, so the seek has to be dressed as the 206 it actually is.
     * Chromium does the reading; this supplies the paperwork.
     */
    let size: number
    try {
      size = (await fs.stat(abs)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const range = parseByteRange(wanted, size)
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }
      })
    }

    try {
      if (!range) {
        // Nothing worth honouring in the header — answer whole, and say that
        // ranges are available so the next request can ask for one.
        const whole = await net.fetch(fileUrl)
        const headers = new Headers(whole.headers)
        headers.set('Accept-Ranges', 'bytes')
        return new Response(whole.body, { status: 200, headers })
      }

      const res = await net.fetch(fileUrl, {
        headers: { Range: `bytes=${range.start}-${range.end}` }
      })
      // Its own headers are kept, `Content-Type` above all: without it the
      // player has to guess at the container from the bytes.
      const headers = new Headers(res.headers)
      headers.set('Accept-Ranges', 'bytes')
      headers.set('Content-Range', contentRange(range, size))
      headers.set('Content-Length', String(range.end - range.start + 1))
      return new Response(res.body, { status: 206, statusText: 'Partial Content', headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
