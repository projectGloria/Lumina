/**
 * Turning a clipped page into a note.
 *
 * This runs in the renderer for one reason: converting HTML needs a DOM, and
 * the renderer already has one. Doing it in the main process would mean
 * shipping jsdom to parse documents in the same process that owns the
 * filesystem — a worse trade on both counts.
 *
 * The HTML arriving here came off a web page, so it is treated as hostile
 * throughout. `sanitize` runs before anything else touches the document, and
 * it runs on a **detached** document from `DOMParser`, which never loads a
 * subresource or executes a script even before the stripping happens.
 */
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { clipFrontmatter, clipNoteName, isHttpUrl, type ClipPayload } from '@shared/clip'
import { encodeTarget, joinPath } from '@shared/markdown-parse'
import { openNote } from './actions'
import { useSettings } from '../store/settingsStore'
import { useVault } from '../store/vaultStore'
import { toast } from '../store/uiStore'

/** Elements that carry no readable content, or that would run something. */
const STRIP = [
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'template',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas'
].join(',')

/** Wrappers a page uses for furniture rather than content. */
const CHROME = ['nav', 'header', 'footer', 'aside'].join(',')

/**
 * Strip anything executable, then resolve what is left against the page.
 *
 * Turndown has no opinion about `<script>`: with no rule for it, its *text* is
 * emitted into the markdown. So removal has to happen here rather than being
 * left to the converter.
 */
function sanitize(html: string, pageUrl: string, stripChrome: boolean): HTMLElement {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  const body = doc.body

  for (const node of Array.from(body.querySelectorAll(STRIP))) node.remove()
  if (stripChrome) for (const node of Array.from(body.querySelectorAll(CHROME))) node.remove()
  for (const node of Array.from(body.querySelectorAll('[hidden],[aria-hidden="true"]'))) {
    node.remove()
  }

  for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    // `onclick` and friends would survive into the markdown as attributes on
    // any element turndown decides to keep verbatim.
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || attr.name === 'srcset') el.removeAttribute(attr.name)
    }

    const href = el.getAttribute('href')
    if (href !== null) {
      const absolute = resolve(href, pageUrl)
      // A link that is not http(s) after resolution — `javascript:`, `data:` —
      // becomes plain text rather than a link in the note.
      if (absolute) el.setAttribute('href', absolute)
      else el.removeAttribute('href')
    }

    const src = el.getAttribute('src')
    if (src !== null) {
      const absolute = resolve(src, pageUrl)
      if (absolute) el.setAttribute('src', absolute)
      else el.remove()
    }
  }

  return body
}

/** Absolute http(s) URL, or null for anything we will not follow or link. */
function resolve(value: string, base: string): string | null {
  try {
    const url = new URL(value, base).toString()
    return isHttpUrl(url) ? url : null
  } catch {
    return null
  }
}

function converter(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    // Lumina's own editor writes `**` for bold, so clips match hand-written
    // notes rather than being distinguishable by their syntax.
    strongDelimiter: '**',
    linkStyle: 'inlined'
  })
  service.use(gfm)

  // Anything still holding markup at this point is furniture; keep the text.
  service.remove(['script', 'style', 'noscript'] as unknown as TurndownService.Filter)

  // Turndown pads a list item with three spaces after the marker. Valid, but
  // Lumina's own list commands write one, and a clip should not be
  // distinguishable from a hand-written note by its whitespace.
  service.addRule('tightListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      // Nested content lines up under the marker rather than under turndown's
      // wider default, so a nested list still parses as nested.
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/\n/gm, '\n  ')

      const parent = node.parentNode as HTMLElement | null
      let prefix = `${options.bulletListMarker} `
      if (parent && parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1)
        const index = Array.prototype.indexOf.call(parent.children, node)
        prefix = `${(Number.isFinite(start) ? start : 1) + index}. `
      }
      return `${prefix}${body}${node.nextSibling ? '\n' : ''}`
    }
  })

  // A markdown destination ends at the first space, the same rule that governs
  // pasted attachments — so every URL written here is encoded the same way.
  service.addRule('encodedImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLImageElement
      const src = el.getAttribute('src')
      if (!src) return ''
      const alt = (el.getAttribute('alt') ?? '').replace(/[[\]]/g, '')
      return `\n\n![${alt}](${/^[a-z][a-z0-9+.-]*:/i.test(src) ? src : encodeTarget(src)})\n\n`
    }
  })

  return service
}

/**
 * Copy the page's images into the vault and repoint the document at them.
 *
 * Done before conversion so the markdown only ever names local files. Failures
 * are left pointing at the original URL rather than dropped — a remote image
 * that still loads beats a broken embed.
 */
async function localizeImages(body: HTMLElement, folder: string): Promise<number> {
  const images = Array.from(body.querySelectorAll('img'))
    .map((img) => ({ img, src: img.getAttribute('src') ?? '' }))
    .filter(({ src }) => isHttpUrl(src))
  if (!images.length) return 0

  // One request per distinct URL, however many times the page uses it.
  const unique = [...new Set(images.map(({ src }) => src))]
  const saved = new Map<string, string>()
  await Promise.all(
    unique.map(async (src) => {
      const path = await window.lumina.clipper.saveImage(folder, src)
      if (path) saved.set(src, path)
    })
  )

  for (const { img, src } of images) {
    const local = saved.get(src)
    if (local) img.setAttribute('src', local)
  }
  return saved.size
}

/**
 * Tidy the whitespace a converted page arrives with.
 *
 * The markup between two block elements is itself a text node, so turndown
 * emits lines holding nothing but a space, and a stripped `<nav>` leaves a run
 * of blank lines behind it. Neither changes how the note renders, but both show
 * up the moment the user edits it.
 *
 * Only runs outside fenced code, where a line of spaces can be deliberate.
 */
function tidy(markdown: string): string {
  let fenced = false
  const lines = markdown.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    return fenced || line.trim() ? line : ''
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** The body of the note, mode by mode. */
function markdownFor(clip: ClipPayload, body: HTMLElement | null): string {
  if (clip.mode === 'bookmark' || !body) {
    return clip.excerpt ? `> ${clip.excerpt.replace(/\n+/g, ' ')}\n` : ''
  }
  const markdown = tidy(converter().turndown(body.innerHTML))
  // A selection is a quotation out of a larger page, so it is marked as one.
  if (clip.mode !== 'selection') return markdown
  return markdown
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
}

/**
 * Write a clip into the vault and, unless told otherwise, open it.
 *
 * Returns the note's path, or null when nothing could be written — the caller
 * has already told the browser the clip was accepted, so a failure here has to
 * surface in the app rather than being swallowed.
 */
export async function clipToNote(clip: ClipPayload): Promise<string | null> {
  const { clipper } = useSettings.getState().settings
  const folder = clipper.folder || 'Clippings'

  const body =
    clip.mode === 'bookmark'
      ? null
      : sanitize(clip.html, clip.url, clip.mode === 'article')

  let imageFolder = ''
  if (body && clipper.downloadImages) {
    imageFolder = joinPath(folder, 'images')
    await localizeImages(body, imageFolder)
  }

  const parts = [clipFrontmatter(clip, clipper.tags)]
  parts.push(`\n# ${clip.title || clipNoteName(clip.title, clip.url)}\n`)
  // The source is in the frontmatter, but a visible link is what makes a clip
  // useful when it is read rather than queried.
  parts.push(`\n[${hostOf(clip.url)}](${clip.url})\n`)
  if (clip.remark) parts.push(`\n> [!note] ${clip.remark}\n`)

  const markdown = markdownFor(clip, body).trim()
  if (markdown) parts.push(`\n${markdown}\n`)

  const name = clipNoteName(clip.title, clip.url, new Date(clip.clippedAt))
  const created = await window.lumina.notes.create(joinPath(folder, name), parts.join(''))
  if (!created.ok || !created.data) {
    toast(created.error ?? 'Could not save the clip', 'error')
    return null
  }

  if (clipper.openOnClip) openNote(created.data, { newTab: true })
  else toast(`Clipped “${clip.title || hostOf(clip.url)}”`)
  return created.data
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Clips that arrived before there was a vault to write into.
 *
 * Mirrors `requestQuickNote`: the main process queues across the window's cold
 * start, and this covers the stretch after the renderer is up but before a
 * vault is open — the profile picker, or a passlock. A clip is a whole page the
 * browser already reported as sent, so these are queued rather than counted.
 */
const pending: ClipPayload[] = []

export function requestClip(clip: ClipPayload): void {
  pending.push(clip)
  void drainClips()
}

/** Called again once a vault opens, so a clip taken at the lock screen lands. */
export async function drainClips(): Promise<void> {
  if (!useVault.getState().vault) return
  while (pending.length) {
    const clip = pending.shift() as ClipPayload
    try {
      await clipToNote(clip)
    } catch (err) {
      toast(`Could not save the clip: ${(err as Error).message}`, 'error')
    }
  }
}
