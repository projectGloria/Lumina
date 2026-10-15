/**
 * Which destinations Lumina is willing to fetch from.
 *
 * Split out of `net.ts` and deliberately free of any `electron` import, for the
 * same reason `transcribe.ts` and `openFile.ts` are: the address ranges are the
 * interesting part and the part that is easy to get subtly wrong, and a test
 * for them should not have to stand up Electron to run.
 */
import dns from 'node:dns/promises'
import net from 'node:net'

/** http(s) only. `lumina:`, `file:` and `data:` never reach the network layer. */
export function isHttp(url: string): boolean {
  try {
    const scheme = new URL(url).protocol
    return scheme === 'http:' || scheme === 'https:'
  } catch {
    return false
  }
}

/**
 * Whether a literal IP address is one we refuse to talk to.
 *
 * Anything not a valid IP literal is reported private — callers resolve names
 * first, so a bare name arriving here is a mistake and must fail closed.
 */
export function isPrivateAddress(address: string): boolean {
  const kind = net.isIP(address)

  if (kind === 4) {
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = parts
    if (a === 0) return true // "this network"
    if (a === 10) return true // RFC 1918
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
    if (a === 192 && b === 168) return true // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true // RFC 6598 carrier NAT
    if (a === 192 && b === 0) return true // IETF protocol assignments
    if (a >= 224) return true // multicast, reserved, broadcast
    return false
  }

  if (kind === 6) {
    // URL canonicalization converts dotted mapped addresses to hexadecimal.
    let literal = address.toLowerCase().split('%')[0]
    const dotted = literal.match(/(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) {
      const bytes = dotted[1].split('.').map(Number)
      literal = literal.slice(0, -dotted[1].length) + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16)
    }
    const [left, right] = literal.split('::')
    const head = left ? left.split(':') : []
    const tail = right ? right.split(':') : []
    const words = (right !== undefined ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head).map((part) => parseInt(part, 16))
    if (words.slice(0, 6).every((n) => n === 0)) return true // unspecified, loopback, compatible IPv4
    if (words.slice(0, 5).every((n) => n === 0) && words[5] === 0xffff) {
      return isPrivateAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`)
    }
    if ((words[0] & 0xfe00) === 0xfc00) return true
    if ((words[0] & 0xffc0) === 0xfe80) return true
    if ((words[0] & 0xff00) === 0xff00) return true
    if (words[0] === 0x64 && words[1] === 0xff9b) return true // translated IPv4

    return false
  }

  return true
}

/**
 * Whether a URL's host resolves somewhere on the public internet.
 *
 * Binding a fetch to http(s) is not enough on its own: a note can name
 * `http://192.168.1.1/` or `http://169.254.169.254/latest/meta-data/`, and with
 * link previews on the page title comes back into the UI as a readable answer —
 * which turns a note someone else wrote (a clip, a synced vault, a shared
 * folder) into a probe of the user's own network. Response timing distinguishes
 * an open port from a closed one even without the title.
 *
 * Every address a name resolves to must be routable; one private answer in a
 * round-robin refuses the whole name. Fails closed on a resolution error.
 */
export async function isPubliclyRoutable(url: string): Promise<boolean> {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }

  const literal = hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(literal)) return !isPrivateAddress(literal)

  // `.local` is mDNS and never public; `localhost` may not even reach a resolver.
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return false

  try {
    const resolved = await dns.lookup(hostname, { all: true, verbatim: true })
    if (!resolved.length) return false
    return resolved.every((entry) => !isPrivateAddress(entry.address))
  } catch {
    return false
  }
}
