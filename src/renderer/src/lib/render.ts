/** Markdown to standalone HTML, used only by the export commands. */
import { marked, Renderer } from 'marked'
import { parseFrontmatter, resolveLink } from '@shared/markdown-parse'
import { aliasMap, knownPaths, titleOf } from '../store/vaultStore'

/**
 * Wikilinks and tags, applied to the rendered document rather than the source.
 *
 * Injecting `<span>` into the markdown before parsing looks simpler but cannot
 * work alongside the hardened renderer below: marked routes inline HTML through
 * `renderer.html` too, so the escaping meant for note-authored HTML escaped our
 * own spans and every exported link came out as literal markup. Decorating text
 * nodes afterwards keeps the two apart, and skipping `code`, `pre` and `a` gives
 * the same code-masking `maskCode` provides everywhere else — a `#hashtag` in a
 * fenced example stays an example.
 */
// The tag half mirrors `TAG_RE` in markdown-parse, unicode range included, so
// the export marks exactly what the indexer counted.
const DECORATE_RE =
  /(?<wiki>!?\[\[[^[\]\n]+?\]\])|(?<=^|[^\w`/])#(?<tag>[A-Za-z0-9_À-￿][A-Za-z0-9_\-/À-￿]*)/g

function decorate(html: string, fromPath: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  const paths = knownPaths()
  const aliases = aliasMap()

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const pending: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (text.parentElement?.closest('code, pre, a')) continue
    DECORATE_RE.lastIndex = 0
    if (DECORATE_RE.test(text.data)) pending.push(text)
  }

  for (const text of pending) {
    // A `#` on a heading line is the heading marker, which the parser has
    // already consumed; anything left there is prose, not a tag.
    const inHeading = !!text.parentElement?.closest('h1, h2, h3, h4, h5, h6')
    const fragment = doc.createDocumentFragment()
    let last = 0
    let match: RegExpExecArray | null

    DECORATE_RE.lastIndex = 0
    while ((match = DECORATE_RE.exec(text.data))) {
      const { wiki, tag } = match.groups ?? {}
      // `#1` is a number, and a `#` left on a heading line is prose — both are
      // the same exclusions `extractTags` applies.
      if (tag && (inHeading || /^\d+$/.test(tag))) continue
      if (match.index > last) fragment.append(text.data.slice(last, match.index))
      fragment.append(
        wiki ? wikilinkSpan(doc, wiki, fromPath, paths, aliases) : tagSpan(doc, tag!)
      )
      last = match.index + match[0].length
    }

    if (last < text.data.length) fragment.append(text.data.slice(last))
    text.replaceWith(fragment)
  }

  return doc.body.innerHTML
}

function wikilinkSpan(
  doc: Document,
  raw: string,
  fromPath: string,
  paths: string[],
  aliases: ReadonlyMap<string, string>
): HTMLElement {
  const inner = raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '')
  const [targetPart, alias] = inner.split('|')
  const target = targetPart.split(/[#^]/)[0].trim()
  const resolved = resolveLink(target, fromPath, paths, aliases)

  const span = doc.createElement('span')
  span.className = resolved ? 'wikilink' : 'wikilink unresolved'
  // textContent, so a note title containing `<` cannot become markup.
  span.textContent = alias?.trim() || (resolved ? titleOf(resolved) : target)
  return span
}

function tagSpan(doc: Document, tag: string): HTMLElement {
  const span = doc.createElement('span')
  span.className = 'tag'
  span.textContent = `#${tag}`
  return span
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

function safeExportUrl(value: string, image = false): string | null {
  const url = value.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '')
  if (!url) return null
  if (url.startsWith('#') || /^(?:\.\.?\/|\/)/.test(url)) return value
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase()
  if (!scheme) return value
  if (scheme === 'http' || scheme === 'https') return value
  if (!image && scheme === 'mailto') return value
  if (image && scheme === 'data' && /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);/i.test(url)) {
    return value
  }
  return null
}

const exportRenderer = new Renderer()
exportRenderer.html = ({ text }) => escapeHtml(text)
exportRenderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens)
  const safe = safeExportUrl(href)
  if (!safe) return label
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(safe)}"${titleAttr} rel="noreferrer noopener">${label}</a>`
}
exportRenderer.image = ({ href, title, text }) => {
  const safe = safeExportUrl(href, true)
  if (!safe) return escapeHtml(text)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttr}>`
}

/** Snapshot the live theme so the export looks like what is on screen. */
function currentTokens(): string {
  const style = getComputedStyle(document.documentElement)
  const names = [
    'bg', 'surface', 'surface-hover', 'border', 'text', 'text-muted', 'text-faint',
    'accent', 'accent-soft', 'link', 'link-unresolved', 'tag-bg', 'tag-text',
    'code-bg', 'code-text', 'quote-border', 'hr', 'mark-bg',
    'font-ui', 'font-serif', 'font-mono', 'font-size', 'line-height', 'radius'
  ]
  return names
    .map((n) => `--lum-${n}: ${style.getPropertyValue(`--lum-${n}`).trim()};`)
    .join('\n    ')
}

export function renderToHtml(markdownSource: string, path: string): string {
  const { data, body } = parseFrontmatter(markdownSource)
  const title = (typeof data.title === 'string' && data.title) || titleOf(path)
  const parsed = marked.parse(body, {
    async: false,
    gfm: true,
    breaks: false,
    renderer: exportRenderer
  })
  const html = decorate(parsed, path)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; base-uri 'none'; object-src 'none'">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    ${currentTokens()}
  }
  body {
    margin: 0;
    padding: 3rem 1.5rem 6rem;
    background: var(--lum-bg);
    color: var(--lum-text);
    font-family: var(--lum-font-ui);
    font-size: var(--lum-font-size);
    line-height: var(--lum-line-height);
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 { font-family: var(--lum-font-serif); font-weight: 600; line-height: 1.3; margin: 1.8em 0 0.6em; }
  h1 { font-size: 1.85em; margin-top: 0; }
  h2 { font-size: 1.45em; }
  h3 { font-size: 1.22em; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1.1em; }
  a { color: var(--lum-link); }
  code { font-family: var(--lum-font-mono); font-size: 0.88em; background: var(--lum-code-bg); color: var(--lum-code-text); padding: 0.12em 0.36em; border-radius: 5px; }
  pre { background: var(--lum-code-bg); padding: 1em 1.2em; border-radius: var(--lum-radius); overflow-x: auto; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { border-left: 3px solid var(--lum-quote-border); margin-left: 0; padding-left: 1.2em; color: var(--lum-text-muted); font-style: italic; }
  hr { border: none; border-top: 1px solid var(--lum-hr); margin: 2.4em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--lum-border); padding: 0.5em 0.75em; text-align: left; }
  th { background: var(--lum-surface-hover); }
  img { max-width: 100%; border-radius: var(--lum-radius); }
  mark { background: var(--lum-mark-bg); }
  .wikilink { color: var(--lum-link); }
  .wikilink.unresolved { color: var(--lum-link-unresolved); }
  .tag { background: var(--lum-tag-bg); color: var(--lum-tag-text); border-radius: 999px; padding: 0.08em 0.55em; font-size: 0.86em; }
  ul li::marker { color: var(--lum-accent); }
  @media print { body { padding: 0; } }
</style>
</head>
<body><main>${html}</main></body>
</html>`
}
