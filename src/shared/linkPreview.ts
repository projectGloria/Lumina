/**
 * The pure half of link banners: what a URL says about itself, and what a
 * fetched page says about itself.
 *
 * Split out of the widget for the same reason `markdown-parse.ts` is split out
 * of the editor — both sides need it (the renderer draws the card, the main
 * process fills it in) and `tests/link-preview.test.ts` can cover it in node.
 */

export interface LinkParts {
  /** Hostname without a leading `www.`, or '' when the URL will not parse. */
  host: string
  /** Path and query, trimmed of a trailing slash. '' for a bare domain. */
  trail: string
  /** Single uppercase character standing in for a favicon we will not fetch. */
  monogram: string
}

/** Metadata read off a page, all optional — most sites carry some of it. */
export interface LinkMetadata {
  title?: string
  description?: string
  /** Absolute URL of the preview image, if the page named one. */
  image?: string
  /** Local vault-relative path the image was cached to, once downloaded. */
  imagePath?: string
  /** Epoch ms this was fetched, so a cache can age out. */
  fetchedAt: number
}

export function parseLinkUrl(raw: string): LinkParts {
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    const trail = `${url.pathname}${url.search}`.replace(/\/$/, '')
    return {
      host,
      trail: trail === '' || trail === '/' ? '' : trail,
      monogram: (host[0] ?? '?').toUpperCase()
    }
  } catch {
    return { host: '', trail: '', monogram: '?' }
  }
}

/**
 * A stable slot in the card palette for a host, so github.com is always the
 * same colour without hardcoding a table of brands (and without fetching a
 * favicon, which would put every pasted link on the network).
 */
export function linkAccentIndex(host: string, buckets = 6): number {
  let hash = 0
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0
  return hash % buckets
}

/** A readable title for a link with nothing better to show: the last path segment. */
export function titleFromUrl(raw: string): string {
  const { host, trail } = parseLinkUrl(raw)
  if (!host) return raw
  const segment = trail.split('?')[0].split('/').filter(Boolean).pop()
  if (!segment) return host
  return decodeURIComponent(segment)
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

/** Human-friendly card copy when a site does not expose preview metadata. */
export function fallbackLinkDetails(raw: string): { title: string; description: string } {
  const { host, trail } = parseLinkUrl(raw)
  const normalized = host.toLowerCase()

  if (normalized === 'youtube.com' || normalized === 'youtu.be' || normalized.endsWith('.youtube.com')) {
    return { title: 'YouTube', description: 'Watch this video on YouTube' }
  }
  if (normalized === 'gemini.google.com') {
    return { title: 'Gemini', description: 'Open this conversation in Google Gemini' }
  }

  return {
    title: titleFromUrl(raw),
    description: trail ? `Open this page on ${host}` : `Visit ${host || raw}`
  }
}

export interface StandaloneLink {
  /** The link's own text, or '' for a bare URL. */
  label: string
  url: string
}

/**
 * A line that is nothing but one link, which is what earns a banner instead of
 * an inline chip: `https://x`, `[label](https://x)`, or either wrapped in `<>`.
 *
 * Anything else on the line — a word, a second link, a list bullet — means the
 * link is part of a sentence and should stay inline. Only http(s) qualifies;
 * `mailto:` and friends have nothing to preview.
 */
const BARE_LINE = /^\s*<?(https?:\/\/[^\s<>()]+)>?\s*$/i
const MD_LINE = /^\s*\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s<>()]+)>?\s*\)\s*$/i

export function standaloneLink(lineText: string): StandaloneLink | null {
  const md = MD_LINE.exec(lineText)
  if (md) return { label: md[1].trim(), url: md[2] }
  const bare = BARE_LINE.exec(lineText)
  if (bare) return { label: '', url: bare[1] }
  return null
}

/* ------------------------------------------------------------- page metadata */

function decodeEntities(value: string): string {
  return value
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1]?.toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      const named: Record<string, string> = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—'
      }
      return named[entity.toLowerCase()] ?? whole
    })
    .trim()
}

function metaContent(html: string, property: string): string | undefined {
  // Attribute order varies by site, so match a whole tag and read inside it.
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const name = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]
    if (name?.toLowerCase() !== property) continue
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]
    if (content) return decodeEntities(content)
  }
  return undefined
}

/**
 * Read the handful of tags worth showing on a card, preferring Open Graph and
 * falling back to what every page has.
 *
 * Deliberately regex over a parser: the main process only ever sees the first
 * chunk of a response (see `main/linkPreview.ts`), which is usually a partial
 * document that a real parser would have to guess its way through anyway.
 */
export function parseOgTags(html: string): Omit<LinkMetadata, 'fetchedAt'> {
  const head = html.slice(0, 200_000)
  const title =
    metaContent(head, 'og:title') ??
    metaContent(head, 'twitter:title') ??
    (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1])
      : undefined)

  const description =
    metaContent(head, 'og:description') ??
    metaContent(head, 'twitter:description') ??
    metaContent(head, 'description')

  const image = metaContent(head, 'og:image') ?? metaContent(head, 'twitter:image')

  return {
    title: title?.replace(/\s+/g, ' ').trim() || undefined,
    description: description?.replace(/\s+/g, ' ').trim() || undefined,
    image: image?.trim() || undefined
  }
}
