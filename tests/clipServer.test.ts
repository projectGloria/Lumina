/**
 * The three predicates the clip listener's security rests on.
 *
 * `src/main/clipServer.ts` says of them: "the parsing and predicate half is
 * exported and pure, because that is the half worth testing and the half that
 * is easy to get subtly wrong." This is that half.
 */
import { describe, expect, it } from 'vitest'
import {
  CLIP_TOKEN_HEADER,
  generateClipToken,
  isExtensionOrigin,
  isLoopbackHost,
  tokenMatches
} from '../src/main/clipServer'

describe('tokenMatches', () => {
  it('accepts the exact token', () => {
    const token = generateClipToken()
    expect(tokenMatches(token, token)).toBe(true)
  })

  it('refuses a wrong token', () => {
    expect(tokenMatches('wrong', generateClipToken())).toBe(false)
  })

  /**
   * `timingSafeEqual` throws on a length mismatch, which would leak the token's
   * length as an exception. Hashing first makes both sides 32 bytes.
   */
  it('refuses a token of a different length without throwing', () => {
    const token = generateClipToken()
    expect(() => tokenMatches('x', token)).not.toThrow()
    expect(tokenMatches('x', token)).toBe(false)
    expect(tokenMatches(`${token}x`, token)).toBe(false)
    expect(tokenMatches('x'.repeat(500), token)).toBe(false)
  })

  it('refuses when either side is missing', () => {
    expect(tokenMatches(undefined, generateClipToken())).toBe(false)
    expect(tokenMatches('', generateClipToken())).toBe(false)
    // An install that never enabled the clipper has no token; an empty
    // expectation must never be satisfiable.
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches('anything', '')).toBe(false)
  })

  it('mints tokens that are unguessable and URL-safe', () => {
    const a = generateClipToken()
    const b = generateClipToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })

  it('names its header in lower case, as node delivers it', () => {
    expect(CLIP_TOKEN_HEADER).toBe(CLIP_TOKEN_HEADER.toLowerCase())
  })
})

describe('isLoopbackHost', () => {
  const PORT = 41999

  /**
   * This is the DNS-rebinding guard. Binding to 127.0.0.1 does not stop a
   * hostile page pointing a name it controls at the loopback address and
   * having the browser connect on its behalf — checking `Host` does.
   */
  it('accepts the loopback names on the right port', () => {
    expect(isLoopbackHost('127.0.0.1:41999', PORT)).toBe(true)
    expect(isLoopbackHost('localhost:41999', PORT)).toBe(true)
    expect(isLoopbackHost('[::1]:41999', PORT)).toBe(true)
    expect(isLoopbackHost('LOCALHOST:41999', PORT)).toBe(true)
  })

  it('accepts a loopback name with no port', () => {
    expect(isLoopbackHost('localhost', PORT)).toBe(true)
    expect(isLoopbackHost('127.0.0.1', PORT)).toBe(true)
  })

  it('refuses a name that merely resolves to loopback', () => {
    expect(isLoopbackHost('evil.example.com:41999', PORT)).toBe(false)
    expect(isLoopbackHost('localhost.evil.com:41999', PORT)).toBe(false)
    expect(isLoopbackHost('127.0.0.1.evil.com:41999', PORT)).toBe(false)
  })

  it('refuses a different port', () => {
    expect(isLoopbackHost('localhost:1234', PORT)).toBe(false)
  })

  it('refuses a missing or malformed host', () => {
    expect(isLoopbackHost(undefined, PORT)).toBe(false)
    expect(isLoopbackHost('', PORT)).toBe(false)
    expect(isLoopbackHost('a:b:c:d', PORT)).toBe(false)
  })
})

describe('isExtensionOrigin', () => {
  it('accepts the three extension schemes', () => {
    expect(isExtensionOrigin('chrome-extension://abcdefghijklmnop')).toBe(true)
    expect(isExtensionOrigin('moz-extension://abcdefghijklmnop')).toBe(true)
    expect(isExtensionOrigin('safari-web-extension://abcdefghijklmnop')).toBe(true)
  })

  it('refuses an ordinary web origin', () => {
    // A page on the open web gets no `Access-Control-Allow-Origin`, so its
    // preflight fails and the real request is never sent.
    expect(isExtensionOrigin('https://evil.com')).toBe(false)
    expect(isExtensionOrigin('http://localhost:3000')).toBe(false)
    expect(isExtensionOrigin('null')).toBe(false)
    expect(isExtensionOrigin(undefined)).toBe(false)
  })

  it('refuses an extension scheme embedded in something else', () => {
    expect(isExtensionOrigin('https://evil.com/chrome-extension://x')).toBe(false)
    expect(isExtensionOrigin('chrome-extension://abc/../../evil')).toBe(false)
    expect(isExtensionOrigin('chrome-extension://abc.evil.com')).toBe(false)
  })
})
