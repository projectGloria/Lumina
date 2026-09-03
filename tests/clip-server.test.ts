import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLIP_TOKEN_HEADER,
  generateClipToken,
  isExtensionOrigin,
  isLoopbackHost,
  startClipServer,
  stopClipServer,
  tokenMatches
} from '../src/main/clipServer'
import type { ClipPayload } from '@shared/clip'

/**
 * The only inbound connection Lumina accepts, so these run against a real
 * listener on a real socket rather than a mocked request: the guards that
 * matter (loopback binding, the Host check, the token, the body cap) are
 * properties of the running server, and a hand-rolled fake would be testing
 * the fake.
 */

const TOKEN = 'test-token-value'
const PORT = 41997

let received: ClipPayload[] = []

async function start(port = PORT, token = TOKEN): Promise<string | null> {
  received = []
  return startClipServer({
    port,
    token,
    onClip: async (clip) => {
      received.push(clip)
      return { ok: true }
    }
  })
}

const post = (body: unknown, headers: Record<string, string> = {}, port = PORT): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/clip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIP_TOKEN_HEADER]: TOKEN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

const clip = {
  mode: 'article',
  url: 'https://example.com/a',
  title: 'A post',
  html: '<p>Hello</p>'
}

/**
 * One request over a raw socket.
 *
 * Two reasons not to use `fetch` here: `Host` is a forbidden header it silently
 * replaces, and its connection pool reuses a socket the body-cap test
 * deliberately destroys, which surfaces as an unrelated ECONNRESET later.
 */
function rawRequest(
  host: string,
  body: string,
  { method = 'POST', path = '/clip', port = PORT } = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\n` +
          `Host: ${host}\r\n` +
          `Content-Type: application/json\r\n` +
          `${CLIP_TOKEN_HEADER}: ${TOKEN}\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n\r\n${body}`
      )
    })
    let response = ''
    socket.on('data', (chunk) => {
      response += chunk.toString()
    })
    socket.on('end', () => {
      const status = response.match(/^HTTP\/1\.\d (\d{3})/)
      status ? resolve(Number(status[1])) : reject(new Error(`No status line: ${response}`))
    })
    socket.on('error', reject)
  })
}

afterEach(async () => {
  await stopClipServer()
})

describe('isLoopbackHost', () => {
  it('accepts the names the browser actually sends', () => {
    expect(isLoopbackHost('127.0.0.1:41999', 41999)).toBe(true)
    expect(isLoopbackHost('localhost:41999', 41999)).toBe(true)
    expect(isLoopbackHost('[::1]:41999', 41999)).toBe(true)
    expect(isLoopbackHost('localhost', 41999)).toBe(true)
  })

  it('refuses a name someone pointed at 127.0.0.1', () => {
    // DNS rebinding: binding to loopback does not stop this, the check does.
    expect(isLoopbackHost('evil.example.com:41999', 41999)).toBe(false)
    expect(isLoopbackHost('localhost.evil.com:41999', 41999)).toBe(false)
    expect(isLoopbackHost('127.0.0.1.evil.com', 41999)).toBe(false)
    expect(isLoopbackHost(undefined, 41999)).toBe(false)
  })

  it('refuses a mismatched port', () => {
    expect(isLoopbackHost('127.0.0.1:1234', 41999)).toBe(false)
  })
})

describe('isExtensionOrigin', () => {
  it('accepts the three extension schemes', () => {
    expect(isExtensionOrigin('chrome-extension://abcdefghijk')).toBe(true)
    expect(isExtensionOrigin('moz-extension://abcdefghijk')).toBe(true)
  })

  it('refuses web origins and lookalikes', () => {
    for (const origin of [
      'https://example.com',
      'http://localhost:3000',
      'null',
      'chrome-extension://abc/../..',
      'https://chrome-extension.evil.com',
      undefined
    ]) {
      expect(isExtensionOrigin(origin)).toBe(false)
    }
  })
})

describe('tokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abc', 'abd')).toBe(false)
    expect(tokenMatches('ab', 'abc')).toBe(false)
    expect(tokenMatches('abcd', 'abc')).toBe(false)
  })

  it('never matches on an empty side, whichever it is', () => {
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches(undefined, 'abc')).toBe(false)
    expect(tokenMatches('abc', '')).toBe(false)
  })

  it('generates tokens that are unique and URL-safe', () => {
    const a = generateClipToken()
    expect(a).not.toBe(generateClipToken())
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThan(24)
  })
})

describe('the running server', () => {
  it('accepts a valid clip and hands it over', async () => {
    expect(await start()).toBeNull()

    const res = await post(clip)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(received).toHaveLength(1)
    expect(received[0].url).toBe('https://example.com/a')
  })

  it('refuses a request with no token', async () => {
    await start()
    const res = await fetch(`http://127.0.0.1:${PORT}/clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(clip)
    })
    expect(res.status).toBe(401)
    expect(received).toHaveLength(0)
  })

  it('refuses a request with the wrong token', async () => {
    await start()
    const res = await post(clip, { [CLIP_TOKEN_HEADER]: 'wrong' })
    expect(res.status).toBe(401)
    expect(received).toHaveLength(0)
  })

  it('refuses a forged Host header even with a good token', async () => {
    await start()
    // Written over a raw socket on purpose: `Host` is a forbidden header, so
    // `fetch` silently replaces whatever is passed and the request would be
    // testing nothing. A hostile page cannot set it either — but the browser
    // sets it to the attacker's own name, which is exactly this shape.
    const status = await rawRequest('evil.example.com', JSON.stringify(clip))
    expect(status).toBe(403)
    expect(received).toHaveLength(0)
  })

  it('accepts the same request once the Host is loopback', async () => {
    await start()
    expect(await rawRequest(`127.0.0.1:${PORT}`, JSON.stringify(clip))).toBe(200)
    expect(received).toHaveLength(1)
  })

  it('refuses a web page origin outright', async () => {
    await start()
    const res = await post(clip, { origin: 'https://evil.example.com' })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(received).toHaveLength(0)
  })

  it('answers an extension preflight but not a web one', async () => {
    await start()
    const ext = await fetch(`http://127.0.0.1:${PORT}/clip`, {
      method: 'OPTIONS',
      headers: { origin: 'chrome-extension://abcdefghijk' }
    })
    expect(ext.status).toBe(204)
    expect(ext.headers.get('access-control-allow-origin')).toBe('chrome-extension://abcdefghijk')

    const web = await fetch(`http://127.0.0.1:${PORT}/clip`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com' }
    })
    expect(web.status).toBe(403)
    expect(web.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('rejects a malformed clip without writing anything', async () => {
    await start()
    expect((await post({ ...clip, url: 'javascript:alert(1)' })).status).toBe(422)
    expect((await post({ ...clip, mode: 'screenshot' })).status).toBe(422)
    expect((await post('not json')).status).toBe(400)
    expect(received).toHaveLength(0)
  })

  it('caps the body rather than buffering whatever arrives', async () => {
    await start()
    // Past CLIP_BODY_CAP the socket is destroyed, so this either answers with
    // an error or fails at the transport — both are the guard working.
    const huge = JSON.stringify({ ...clip, html: 'x'.repeat(9 * 1024 * 1024) })
    let status = 0
    try {
      status = (await post(huge)).status
    } catch {
      status = 0
    }
    expect(status === 0 || status >= 400).toBe(true)
    expect(received).toHaveLength(0)
  })

  it('answers /ping only with a token, so a wrong port reads differently', async () => {
    await start()
    const good = await fetch(`http://127.0.0.1:${PORT}/ping`, {
      headers: { [CLIP_TOKEN_HEADER]: TOKEN }
    })
    expect(good.status).toBe(200)
    expect(await good.json()).toEqual({ ok: true, app: 'lumina' })

    const bad = await fetch(`http://127.0.0.1:${PORT}/ping`)
    expect(bad.status).toBe(401)
  })

  it('404s any other path, traversal included', async () => {
    await start()
    const host = `127.0.0.1:${PORT}`
    expect(await rawRequest(host, '', { method: 'GET', path: '/nope' })).toBe(404)
    expect(await rawRequest(host, '', { method: 'GET', path: '/../../etc/passwd' })).toBe(404)
    // The route table is the only thing that ever names a path; nothing here
    // touches the filesystem, so this is belt and braces.
    expect(await rawRequest(host, '', { method: 'GET', path: '/clip' })).toBe(404)
    expect(received).toHaveLength(0)
  })

  it('reports a busy port instead of throwing', async () => {
    expect(await start()).toBeNull()
    // A second listener on the same port, started without stopping the first.
    const second = await startClipServer({
      port: PORT,
      token: TOKEN,
      onClip: async () => ({ ok: true })
    })
    // `startClipServer` stops the previous one first, so this should succeed;
    // the point is that it never throws.
    expect(second === null || second.includes('in use')).toBe(true)
  })

  it('refuses to start with no token at all', async () => {
    expect(await startClipServer({ port: PORT, token: '', onClip: async () => ({ ok: true }) }))
      .toBe('No clipper token is set')
  })

  it('stops listening when told to', async () => {
    await start()
    await stopClipServer()
    await expect(post(clip)).rejects.toThrow()
  })
})
