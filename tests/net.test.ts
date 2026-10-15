/**
 * The outbound-destination guard.
 *
 * `isHttp` alone is not enough: a note can name `http://192.168.1.1/` or the
 * cloud metadata address, and with link previews on the page title comes back
 * into the UI as a readable answer. The ranges below are the ones that must
 * never be fetched, and they are exactly the kind of list that is easy to get
 * subtly wrong — hence this file.
 */
import { describe, expect, it } from 'vitest'
// From `netGuard` rather than `net`: the latter imports Electron, and a unit
// test for address ranges has no business pulling in a browser runtime.
import { isHttp, isPrivateAddress, isPubliclyRoutable } from '../src/main/netGuard'

describe('isHttp', () => {
  it('accepts http and https only', () => {
    expect(isHttp('http://example.com')).toBe(true)
    expect(isHttp('https://example.com')).toBe(true)
    expect(isHttp('file:///etc/passwd')).toBe(false)
    expect(isHttp('data:text/html,x')).toBe(false)
    expect(isHttp('lumina://vault/a.png')).toBe(false)
    expect(isHttp('nonsense')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('rejects IPv4 loopback and the RFC 1918 ranges', () => {
    for (const ip of [
      '127.0.0.1', '127.1.2.3',
      '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.255',
      '192.168.0.1', '192.168.255.255',
      '0.0.0.0'
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  /** The one that matters most: cloud instance metadata. */
  it('rejects the link-local range', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('169.254.0.1')).toBe(true)
  })

  it('rejects carrier-grade NAT and multicast', () => {
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
    expect(isPrivateAddress('100.127.255.255')).toBe(true)
    expect(isPrivateAddress('224.0.0.1')).toBe(true)
    expect(isPrivateAddress('255.255.255.255')).toBe(true)
  })

  it('does not over-reach into neighbouring public ranges', () => {
    for (const ip of [
      '172.15.0.1', '172.32.0.1',   // just outside 172.16/12
      '192.167.0.1', '192.169.0.1', // just outside 192.168/16
      '100.63.255.255', '100.128.0.1', // just outside 100.64/10
      '9.255.255.255', '11.0.0.1',  // just outside 10/8
      '8.8.8.8', '1.1.1.1', '93.184.216.34'
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it('rejects IPv6 loopback, unique-local and link-local', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('sees through an IPv4-mapped IPv6 address', () => {
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('accepts a public IPv6 address', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('treats anything that is not an IP as unsafe', () => {
    // Callers resolve names first; a bare name reaching here is a mistake and
    // must fail closed.
    expect(isPrivateAddress('example.com')).toBe(true)
    expect(isPrivateAddress('')).toBe(true)
  })
})

describe('isPubliclyRoutable', () => {
  it('refuses literal private addresses without touching DNS', async () => {
    expect(await isPubliclyRoutable('http://127.0.0.1:8080/x')).toBe(false)
    expect(await isPubliclyRoutable('http://192.168.1.1/admin')).toBe(false)
    expect(await isPubliclyRoutable('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(await isPubliclyRoutable('http://[::1]:3000/')).toBe(false)
  })

  it('refuses the loopback and mDNS names', async () => {
    expect(await isPubliclyRoutable('http://localhost:41999/clip')).toBe(false)
    expect(await isPubliclyRoutable('http://app.localhost/')).toBe(false)
    expect(await isPubliclyRoutable('http://printer.local/')).toBe(false)
  })

  it('refuses a malformed url', async () => {
    expect(await isPubliclyRoutable('not a url')).toBe(false)
  })

  it('fails closed for a name that does not resolve', async () => {
    // `.invalid` is reserved by RFC 2606 and must never resolve.
    expect(await isPubliclyRoutable('http://nonexistent.invalid/')).toBe(false)
  })

  it('accepts a literal public address', async () => {
    expect(await isPubliclyRoutable('https://8.8.8.8/')).toBe(true)
  })
})
