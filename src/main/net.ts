/**
 * The two network primitives anything outbound in Lumina has to use.
 *
 * Both features that touch the network — link previews and the web clipper —
 * need the same shape: http(s) only, a hard timeout, and a read that stops at a
 * byte cap instead of trusting `Content-Length`. Keeping them here means a
 * third one cannot quietly ship without them, and that the caps are stated
 * once rather than drifting apart.
 */
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import net from 'node:net'
import { Readable } from 'node:stream'
import { isHttp, isPrivateAddress } from './netGuard'

// Which destinations are allowed at all lives in `netGuard.ts`, which imports
// no Electron so it can be tested without standing one up. Re-exported here so
// callers keep finding both halves of "may we fetch this?" in one place.
export { isHttp, isPrivateAddress, isPubliclyRoutable } from './netGuard'

export const TIMEOUT_MS = 6000

export async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = TIMEOUT_MS
): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    let current = url
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!isHttp(current)) throw new Error('Only HTTP(S) destinations are allowed')
      const target = new URL(current)
      const host = target.hostname.replace(/^\[|\]$/g, '')
      if (target.username || target.password || /(?:^|\.)(?:localhost|local)\.?$/i.test(host)) throw new Error('Private destination refused')
      const entries = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await Promise.race([
        dns.lookup(host, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          if (abort.signal.aborted) reject(new Error('Request timed out'))
          else abort.signal.addEventListener('abort', () => reject(new Error('Request timed out')), { once: true })
        })
      ])
      if (!entries.length || entries.some((entry) => isPrivateAddress(entry.address))) throw new Error('Private destination refused')
      if (abort.signal.aborted) throw new Error('Request timed out')
      // Connect to the checked address itself. No second DNS lookup can rebind
      // the connection; TLS and Host still use the original hostname.
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = (target.protocol === 'https:' ? https : http).request(target, {
          hostname: entries[0].address,
          servername: net.isIP(host) ? undefined : host,
          headers: { ...headers, host: target.host, 'accept-encoding': 'identity' },
          signal: abort.signal,
          agent: false
        }, resolve)
        request.on('error', reject)
        request.end()
      })
      const status = response.statusCode ?? 502
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.destroy()
        if (redirects === 5) throw new Error('Too many redirects')
        current = new URL(location, target).href
        continue
      }
      const resultHeaders = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) resultHeaders.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>
      if (!body) response.destroy()
      return new Response(body, { status, headers: resultHeaders })
    }
    throw new Error('Too many redirects')
  } finally { clearTimeout(timer) }
}

/**
 * Read at most `cap` bytes of a response body, then let go of the rest.
 *
 * A server can claim any `Content-Length` it likes, or none, so the cap is
 * enforced against what actually arrives rather than what was promised.
 */
export async function readCapped(
  response: Response,
  cap: number,
  timeoutMs = TIMEOUT_MS
): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let total = 0
  let timer: NodeJS.Timeout | null = null

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void reader.cancel().catch(() => {})
        reject(new Error(`Response body timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    const readLoop = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          total += value.byteLength
          if (total >= cap) {
            await reader.cancel().catch(() => {})
            break
          }
        }
      }
    }

    await Promise.race([readLoop(), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }

  const out = new Uint8Array(Math.min(total, cap))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= out.length) break
    const slice = chunk.subarray(0, out.length - offset)
    out.set(slice, offset)
    offset += slice.length
  }
  return out
}

/**
 * Extensions we are willing to write, keyed by the type the server declared.
 *
 * Deliberately no `image/svg+xml`: an SVG is a document, not a bitmap, and one
 * fetched from a page we do not control has no business being written into
 * someone's notes folder, where another application — or a future Lumina that
 * inlines SVG rather than using `<img>` — might execute what is in it. Locally
 * authored SVG attachments are unaffected; this list only governs downloads.
 */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico'
}
