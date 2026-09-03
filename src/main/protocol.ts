import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { getMusicRoot } from './music'
import { safePathUnder } from './paths'
import { getRoot } from './vault'

/**
 * A custom scheme for reading files out of the open vault.
 *
 * The renderer is served over http in development and file in production, so
 * it cannot load an image sitting next to a note directly, and widening the
 * CSP to allow `file:` would open the whole disk. This serves exactly one
 * folder, and `safeJoin` rejects anything that tries to climb out of it.
 *
 * Images are addressed as `lumina://vault/<vault-relative path>`, and audio
 * from the music folder as `lumina://music/<music-relative path>`. The music
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
      url.hostname === 'vault' ? getRoot() : url.hostname === 'music' ? getMusicRoot() : undefined
    if (root === undefined) return new Response('Not found', { status: 404 })
    if (!root) return new Response('Nothing to serve', { status: 404 })

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const abs = await safePathUnder(root, rel)
    if (!abs) return new Response('Forbidden', { status: 403 })

    try {
      return await net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
