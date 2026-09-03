/**
 * The listener the browser extension posts clips to.
 *
 * This is the only part of Lumina that accepts an inbound connection, so it is
 * written to be boring and closed by default. Five things guard it and none of
 * them is redundant:
 *
 * 1. It binds to `127.0.0.1`, never `0.0.0.0` — nothing off this machine can
 *    reach it, whatever the firewall says.
 * 2. The `Host` header must itself be loopback. A hostile page can point a DNS
 *    name it controls at 127.0.0.1 and have the browser connect on its behalf;
 *    binding alone does not stop that, checking `Host` does.
 * 3. A shared token, compared in constant time, has to be present.
 * 4. That token travels in a custom header, which forces a CORS preflight for
 *    anything running on a real web page — and only extension origins are
 *    answered, so the browser refuses the request before it is ever sent.
 * 5. The body is capped and the socket destroyed past the cap, so a stuck or
 *    malicious client cannot grow the main process's memory.
 *
 * The parsing and predicate half is exported and pure, because that is the half
 * worth testing and the half that is easy to get subtly wrong.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { CLIP_BODY_CAP, validateClip, type ClipPayload } from '@shared/clip'

/** Header the extension carries its token in. Custom, so it forces a preflight. */
export const CLIP_TOKEN_HEADER = 'x-lumina-token'

export const DEFAULT_CLIP_PORT = 41999

/** A fresh shared secret, shown once in settings and pasted into the extension. */
export function generateClipToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Constant-time token comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would leak the token's
 * length through an exception; hashing first makes both sides 32 bytes so the
 * comparison itself is the only thing that runs.
 */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!expected || !provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Whether a `Host` header names this machine's loopback interface.
 *
 * Anything else means the browser resolved some other name to 127.0.0.1 and is
 * talking to us on a hostile page's behalf.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  // IPv6 literals arrive bracketed: `[::1]:41999`.
  const match = host.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/)
  if (!match) return false

  const name = match[1].replace(/^\[|\]$/g, '').toLowerCase()
  const given = match[2]
  if (given && Number(given) !== port) return false

  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

/**
 * Whether an `Origin` may be told the response is readable.
 *
 * Only browser extensions. A page on the open web gets no
 * `Access-Control-Allow-Origin`, so its preflight fails and the real request is
 * never sent — the token check behind this is the second line, not the first.
 */
export function isExtensionOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  return /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9-]+\/?$/i.test(origin)
}

export interface ClipServerOptions {
  port: number
  token: string
  /** Called with a validated clip. Its resolved value is reported to the extension. */
  onClip: (clip: ClipPayload) => Promise<{ ok: boolean; error?: string }>
}

let server: Server | null = null
let current: ClipServerOptions | null = null

/** Read a capped body, rejecting rather than buffering past the limit. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > CLIP_BODY_CAP) {
        reject(new Error('Clip is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // Nothing here is cacheable and none of it should be sniffed.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
  if (origin && isExtensionOrigin(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = `content-type, ${CLIP_TOKEN_HEADER}`
    headers['access-control-allow-methods'] = 'POST, GET, OPTIONS'
    headers['access-control-max-age'] = '600'
    headers.vary = 'Origin'
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const options = current
  if (!options) {
    send(res, 503, { ok: false, error: 'Clipper is off' })
    return
  }

  const origin = req.headers.origin
  const url = (req.url ?? '').split('?')[0]

  if (req.method === 'OPTIONS') {
    // The preflight itself is unauthenticated by definition; it only ever says
    // whether a later request would be allowed to be read.
    send(res, isExtensionOrigin(origin) ? 204 : 403, {}, origin)
    return
  }

  if (!isLoopbackHost(req.headers.host, options.port)) {
    send(res, 403, { ok: false, error: 'Bad host' })
    return
  }

  // A page on the open web can still reach us with a simple request; refusing
  // its origin outright means it never gets even a confirmation we exist.
  if (origin && !isExtensionOrigin(origin)) {
    send(res, 403, { ok: false, error: 'Forbidden' })
    return
  }

  if (!tokenMatches(req.headers[CLIP_TOKEN_HEADER] as string | undefined, options.token)) {
    send(res, 401, { ok: false, error: 'Bad token' }, origin)
    return
  }

  // A reachability check for the extension's options page, so someone can tell
  // a wrong port from a wrong token.
  if (req.method === 'GET' && url === '/ping') {
    send(res, 200, { ok: true, app: 'lumina' }, origin)
    return
  }

  if (req.method !== 'POST' || url !== '/clip') {
    send(res, 404, { ok: false, error: 'Not found' }, origin)
    return
  }

  let clip: ClipPayload | null
  try {
    clip = validateClip(JSON.parse(await readBody(req)))
  } catch (err) {
    send(res, 400, { ok: false, error: (err as Error).message }, origin)
    return
  }
  if (!clip) {
    send(res, 422, { ok: false, error: 'Clip was malformed' }, origin)
    return
  }

  try {
    send(res, 200, await options.onClip(clip), origin)
  } catch (err) {
    send(res, 500, { ok: false, error: (err as Error).message }, origin)
  }
}

/**
 * Start (or restart) the listener.
 *
 * Resolves with an error string rather than throwing, because the usual failure
 * is a port already in use and that has to reach the settings panel as text.
 */
export async function startClipServer(options: ClipServerOptions): Promise<string | null> {
  await stopClipServer()
  if (!options.token) return 'No clipper token is set'

  current = options
  return new Promise((resolve) => {
    const next = createServer((req, res) => {
      void handle(req, res).catch(() => {
        if (!res.headersSent) send(res, 500, { ok: false, error: 'Clip failed' })
      })
    })

    next.on('error', (err: NodeJS.ErrnoException) => {
      server = null
      current = null
      resolve(
        err.code === 'EADDRINUSE'
          ? `Port ${options.port} is already in use`
          : `Could not start the clipper: ${err.message}`
      )
    })

    next.listen(options.port, '127.0.0.1', () => {
      server = next
      resolve(null)
    })
  })
}

export function stopClipServer(): Promise<void> {
  const running = server
  server = null
  current = null
  if (!running) return Promise.resolve()
  return new Promise((resolve) => running.close(() => resolve()))
}

export function clipServerRunning(): boolean {
  return server !== null
}
