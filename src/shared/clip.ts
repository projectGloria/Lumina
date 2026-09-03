/**
 * The contract between the browser extension and Lumina.
 *
 * Everything here is pure, and deliberately so: a clip arrives over HTTP from
 * outside the application, which makes it the least trusted input the app
 * accepts. `validateClip` is the only door it comes through, and the whole
 * point of keeping it here is that `tests/clip.test.ts` can hammer it without
 * standing up a server.
 *
 * Nothing in this file trusts a string it is handed — not the title (it becomes
 * a filename), not the URL (it goes into frontmatter and a link), not the tags.
 */

export type ClipMode = 'article' | 'full' | 'selection' | 'bookmark'

export const CLIP_MODES: ClipMode[] = ['article', 'full', 'selection', 'bookmark']

/** What the extension posts to `/clip`. */
export interface ClipPayload {
  mode: ClipMode
  /** Page address. Always http(s) — anything else is refused. */
  url: string
  title: string
  /** Captured markup. Absent for `bookmark`, which needs no body. */
  html: string
  /** The page's own summary, used as the bookmark body. */
  excerpt: string
  /** og:image, downloaded for a bookmark's thumbnail. */
  image: string
  byline: string
  siteName: string
  /** A note the user typed in the popup before clipping. */
  remark: string
  tags: string[]
  clippedAt: number
}

/** Refuse a body larger than this outright: a clip is text, not a payload. */
export const CLIP_BODY_CAP = 8 * 1024 * 1024
const MAX_HTML = 4 * 1024 * 1024
const MAX_TEXT = 2000
const MAX_TAGS = 24

function str(value: unknown, cap = MAX_TEXT): string {
  if (typeof value !== 'string') return ''
  // Control characters would survive into a filename or a frontmatter line and
  // break the parse; strip them at the door rather than at each use.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, cap).trim()
}

/** http(s) only — the same rule `linkPreview.ts` enforces before it fetches. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Turn whatever arrived on the wire into a `ClipPayload`, or null.
 *
 * Null means "do not write anything to disk". Every field is re-derived rather
 * than spread from the input, so an extra property in the JSON cannot ride
 * along into the note, and a wrong type is a missing value rather than a crash.
 */
export function validateClip(raw: unknown): ClipPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>

  const mode = CLIP_MODES.includes(input.mode as ClipMode) ? (input.mode as ClipMode) : null
  if (!mode) return null

  const url = str(input.url, 4096)
  if (!isHttpUrl(url)) return null

  const html = str(input.html, MAX_HTML)
  // A body-carrying mode with no body is a failed capture, not a clip; writing
  // an empty note would look like the clipper worked.
  if (mode !== 'bookmark' && !html) return null

  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => normalizeTag(String(t))).filter(Boolean))].slice(0, MAX_TAGS)
    : []

  return {
    mode,
    url,
    title: str(input.title, 300),
    html,
    excerpt: str(input.excerpt),
    image: (() => {
      const image = str(input.image, 4096)
      return isHttpUrl(image) ? image : ''
    })(),
    byline: str(input.byline, 200),
    siteName: str(input.siteName, 200),
    remark: str(input.remark),
    tags,
    clippedAt: typeof input.clippedAt === 'number' && Number.isFinite(input.clippedAt)
      ? input.clippedAt
      : Date.now()
  }
}

/**
 * A tag Lumina's own parser would find again.
 *
 * `extractTags` reads frontmatter tags back, so a tag written here has to
 * survive that round trip: no leading `#`, no spaces, and not purely numeric —
 * `#1` is deliberately treated as a number rather than a tag.
 */
export function normalizeTag(raw: string): string {
  const tag = raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}/_-]/gu, '')
    .replace(/^[-/]+|[-/]+$/g, '')
  if (!tag || /^\d+$/.test(tag)) return ''
  return tag.slice(0, 60)
}

/* -------------------------------------------------------------- filenames */

/** Windows refuses these outright, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * A filesystem-safe note name for a clip.
 *
 * The title comes from a web page, so it can hold anything: a colon (illegal on
 * Windows), a slash (a path separator on every platform), a trailing dot (which
 * Windows silently strips, producing a name that does not match what was
 * asked for), or nothing at all.
 */
export function clipNoteName(title: string, url = '', date = new Date()): string {
  let name = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim()

  // Fall back to the host, then to the date — a note still needs a name when
  // the page had no usable title.
  if (!name) {
    try {
      name = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      name = ''
    }
  }
  if (!name) name = `Clip ${date.toISOString().slice(0, 10)}`
  if (RESERVED.test(name)) name = `${name} clip`
  return name
}

/* ------------------------------------------------------------ frontmatter */

/**
 * Quote a value that would otherwise change meaning when parsed back.
 *
 * `parseFrontmatter` coerces `true`, numbers and `[...]` into non-strings, and
 * a leading `#` starts a comment. A title like `[Draft] 2024` has to come back
 * as that string, not as an array.
 */
function yamlValue(value: string): string {
  const needsQuotes =
    value === '' ||
    /^[\s#>[\]{}&*!|'"%@`-]/.test(value) ||
    /:\s/.test(value) ||
    /^(true|false|null|~)$/i.test(value) ||
    /^-?\d+(\.\d+)?$/.test(value)
  if (!needsQuotes) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** ISO date, local, matching how daily notes name themselves. */
function isoDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The frontmatter block for a clipped note.
 *
 * `source` is what makes a clip worth having later, so it is always present.
 * Tags use the inline-array form, which is the one `parseFrontmatter` reads
 * back into a real array.
 */
export function clipFrontmatter(clip: ClipPayload, extraTags: string[] = []): string {
  const tags = [...new Set([...extraTags, ...clip.tags].map(normalizeTag).filter(Boolean))]

  const lines = [
    `title: ${yamlValue(clip.title || clipNoteName(clip.title, clip.url))}`,
    `source: ${yamlValue(clip.url)}`,
    `clipped: ${yamlValue(isoDate(clip.clippedAt))}`
  ]
  if (clip.byline) lines.push(`author: ${yamlValue(clip.byline)}`)
  if (clip.siteName) lines.push(`site: ${yamlValue(clip.siteName)}`)
  if (tags.length) lines.push(`tags: [${tags.join(', ')}]`)

  return `---\n${lines.join('\n')}\n---\n`
}
