import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { safeJoin } from './paths'
import { getRoot } from './vault'

/**
 * A custom scheme for reading files out of the open vault.
 *
 * The renderer is served over http in development and file in production, so
 * it cannot load an image sitting next to a note directly, and widening the
 * CSP to allow `file:` would open the whole disk. This serves exactly one
 * folder, and `safeJoin` rejects anything that tries to climb out of it.
 *
 * Images are addressed as `lumina://vault/<vault-relative path>`.
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

    if (url.hostname !== 'vault') return new Response('Not found', { status: 404 })

    const root = getRoot()
    if (!root) return new Response('No vault open', { status: 404 })

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const abs = safeJoin(root, rel)
    if (!abs) return new Response('Forbidden', { status: 403 })

    try {
      return await net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
