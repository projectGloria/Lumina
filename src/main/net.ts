/**
 * The two network primitives anything outbound in Lumina has to use.
 *
 * Both features that touch the network — link previews and the web clipper —
 * need the same shape: http(s) only, a hard timeout, and a read that stops at a
 * byte cap instead of trusting `Content-Length`. Keeping them here means a
 * third one cannot quietly ship without them, and that the caps are stated
 * once rather than drifting apart.
 */
import { net } from 'electron'

export const TIMEOUT_MS = 6000

/** http(s) only. `lumina:`, `file:` and `data:` never reach the network layer. */
export function isHttp(url: string): boolean {
  try {
    const scheme = new URL(url).protocol
    return scheme === 'http:' || scheme === 'https:'
  } catch {
    return false
  }
}

export async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = TIMEOUT_MS
): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    return await net.fetch(url, {
      headers,
      signal: abort.signal,
      // Redirects stay inside http(s): `net.fetch` will not follow a redirect
      // to another scheme, and this keeps credentials out of the request.
      credentials: 'omit'
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read at most `cap` bytes of a response body, then let go of the rest.
 *
 * A server can claim any `Content-Length` it likes, or none, so the cap is
 * enforced against what actually arrives rather than what was promised.
 */
export async function readCapped(response: Response, cap: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let total = 0
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

/** Extensions we are willing to write, keyed by the type the server declared. */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico'
}
