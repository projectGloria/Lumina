/**
 * The single source of truth for reading structure out of a markdown note.
 *
 * The main-process indexer and the renderer's editor decorations both import
 * this, so link resolution can never disagree between the two sides.
 */
import type { Heading, LinkRef, NoteIndexEntry, Task } from './types'

/* --------------------------------------------------------------- paths */

/** Normalise a path to vault-relative, forward-slash form with no leading `./`. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

export function basename(p: string): string {
  const n = normalizePath(p)
  const i = n.lastIndexOf('/')
  return i === -1 ? n : n.slice(i + 1)
}

export function dirname(p: string): string {
  const n = normalizePath(p)
  const i = n.lastIndexOf('/')
  return i === -1 ? '' : n.slice(0, i)
}

/**
 * Drop a note extension, whichever of the three we accept it is.
 *
 * This has to agree with `isMarkdownPath`: stripping only `.md` would leave a
 * `.markdown` note showing its extension as a title and, worse, would stop any
 * wikilink from ever resolving to it.
 */
export function stripExtension(p: string): string {
  return p.replace(/\.(?:md|markdown|mdx)$/i, '')
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${normalizePath(dir)}/${name}` : name
}

/* --------------------------------------------------- code-span masking */

/** A list bullet, which makes a following indent continuation rather than code. */
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/

/**
 * Replace fenced blocks, indented blocks and inline code spans with spaces.
 *
 * Offsets are preserved exactly, so any match found in the masked text can be
 * applied to the original. This is what keeps a `#hashtag` — or a `#4a7c59`
 * colour in a CSS example — from being indexed as a tag.
 */
export function maskCode(src: string): string {
  const lines = src.split('\n')
  let fence: string | null = null
  let inIndentedCode = false
  let prevBlank = true
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const blank = line.trim() === ''
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/)

    if (fence) {
      lines[i] = ' '.repeat(line.length)
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      prevBlank = false
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      lines[i] = ' '.repeat(line.length)
      prevBlank = false
      inIndentedCode = false
      continue
    }

    // Indented code: four spaces or a tab, starting from a blank line and not
    // inside a list, where the same indent means a wrapped list item instead.
    const indented = /^(?: {4}|\t)/.test(line)
    if (!blank) {
      if (indented && (inIndentedCode || (prevBlank && !inList))) {
        inIndentedCode = true
        lines[i] = ' '.repeat(line.length)
        prevBlank = false
        continue
      }
      inIndentedCode = false
      inList = LIST_ITEM_RE.test(line) || (inList && indented)
    }

    prevBlank = blank
    // Inline code spans: mask the content but keep the line length.
    lines[i] = line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length))
  }
  return lines.join('\n')
}

/* ---------------------------------------------------------- frontmatter */

export interface Frontmatter {
  data: Record<string, unknown>
  /** Body with the frontmatter block blanked out but line numbers preserved. */
  body: string
  /** Number of lines the frontmatter occupies (0 when absent). */
  lines: number
}

function coerce(raw: string): unknown {
  const v = raw.trim()
  if (v === '') return ''
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null' || v === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((s) => coerce(s))
  }
  return v.replace(/^["'](.*)["']$/, '$1')
}

/**
 * Parse a leading `---` block. Supports flat `key: value` pairs, inline arrays
 * and `- item` lists, which is the shape notes actually use. Anything deeper is
 * kept as a raw string rather than throwing.
 */
export function parseFrontmatter(src: string): Frontmatter {
  if (!/^---\r?\n/.test(src)) return { data: {}, body: src, lines: 0 }

  const lines = src.split('\n')
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*\r?$/.test(lines[i])) {
      end = i
      break
    }
  }
  if (end === -1) return { data: {}, body: src, lines: 0 }

  const data: Record<string, unknown> = {}
  let listKey: string | null = null

  for (let i = 1; i < end; i++) {
    const line = lines[i].replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue

    const item = line.match(/^\s*-\s+(.*)$/)
    if (item && listKey && Array.isArray(data[listKey])) {
      ;(data[listKey] as unknown[]).push(coerce(item[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    const [, key, rest] = kv
    if (rest.trim() === '') {
      listKey = key
      data[key] = []
    } else {
      listKey = null
      data[key] = coerce(rest)
    }
  }

  // Blank out the frontmatter so downstream line numbers still line up.
  const body = lines.map((l, i) => (i <= end ? '' : l)).join('\n')
  return { data, body, lines: end + 1 }
}

/* ------------------------------------------------------------- headings */

export function extractHeadings(src: string): Heading[] {
  const masked = maskCode(src)
  const out: Heading[] = []
  masked.split('\n').forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i })
  })
  return out
}

/* ---------------------------------------------------------------- tasks */

/**
 * A checkbox list item: the bullet, the box, and everything after it.
 *
 * Only ` `, `x` and `X` count. Obsidian-style alternatives (`[-]`, `[/]`) are
 * left as ordinary list items rather than guessed at, because Home's tasks
 * widget writes a box back and can only honestly write one it understands.
 */
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](.*)$/

/**
 * Every task in a note, with the line each one is on.
 *
 * Read from `maskCode`d text so a checkbox inside a fenced block is a code
 * sample, not a chore. Line numbers are the note's own, which is what lets a
 * change be written straight back to the source line.
 */
export function extractTasks(src: string): Task[] {
  const out: Task[] = []
  maskCode(src)
    .split('\n')
    .forEach((line, i) => {
      const m = line.match(TASK_RE)
      if (m) out.push({ text: m[3].trim(), done: m[2] !== ' ', line: i })
    })
  return out
}

/**
 * Which line holds the task that was on `line` when the index was taken.
 *
 * A line number alone is not an identity. The index is a snapshot and the text
 * being written may be ahead of it — a note open in a background tab with
 * unsaved edits above the task has already moved it — so `setTaskDone` used to
 * tick whatever checkbox had arrived at that line number instead. Matching the
 * task's own text is what makes it the same task.
 *
 * Returns null rather than guessing when the nearest two matches are the same
 * distance away. Two tasks with identical text in one note is ordinary
 * (`- [ ] follow up` twice), and a coin toss between them would be the very
 * bug this replaces.
 */
export function findTaskLine(content: string, line: number, text: string): number | null {
  const wanted = text.trim()
  if (!wanted) return null

  const lines = maskCode(content).split('\n')
  const onLine = lines[line]?.match(TASK_RE)
  // The overwhelmingly common case: nothing moved.
  if (onLine && onLine[3].trim() === wanted) return line

  let best: number | null = null
  let bestDistance = Infinity
  let tied = false
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_RE)
    if (!m || m[3].trim() !== wanted) continue
    const distance = Math.abs(i - line)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
      tied = false
    } else if (distance === bestDistance) {
      tied = true
    }
  }

  return tied ? null : best
}

/**
 * Tick or untick the checkbox on one line.
 *
 * Returns null when that line is not a task any more — the index is a snapshot,
 * and a note edited since it was taken may have moved the line elsewhere.
 * Writing the box back blind would tick the wrong thing.
 */
export function setTaskDone(content: string, line: number, done: boolean): string | null {
  const lines = content.split('\n')
  const target = lines[line]
  if (target === undefined) return null

  const m = target.match(TASK_RE)
  if (!m) return null

  lines[line] = `${m[1]}[${done ? 'x' : ' '}]${m[3]}`
  return lines.join('\n')
}

/* ----------------------------------------------------------------- tags */

const TAG_RE = /(^|[^\w`/])#([A-Za-z0-9_À-￿][A-Za-z0-9_\-/À-￿]*)/g

export function extractTags(src: string, frontmatter?: Record<string, unknown>): string[] {
  const found = new Set<string>()

  const fmTags = frontmatter?.tags ?? frontmatter?.tag
  if (Array.isArray(fmTags)) {
    fmTags.forEach((t) => found.add(String(t).replace(/^#/, '')))
  } else if (typeof fmTags === 'string') {
    fmTags
      .split(/[,\s]+/)
      .filter(Boolean)
      .forEach((t) => found.add(t.replace(/^#/, '')))
  }

  const masked = maskCode(src)
  for (const line of masked.split('\n')) {
    if (/^#{1,6}\s/.test(line)) continue // ATX heading, not a tag
    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(line))) {
      const tag = m[2]
      if (/^\d+$/.test(tag)) continue // `#1` is a number, not a tag
      found.add(tag)
    }
  }
  return [...found].sort()
}

/* ---------------------------------------------------------------- links */

export interface RawLink {
  target: string
  alias?: string
  anchor?: string
  kind: 'link' | 'embed'
  line: number
  /** Offsets of the whole construct within the source. */
  from: number
  to: number
}

const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g

/** Find every `[[wikilink]]`, `![[embed]]` and relative `[text](note.md)`. */
export function extractLinks(src: string): RawLink[] {
  const masked = maskCode(src)
  const lineStarts: number[] = [0]
  for (let i = 0; i < masked.length; i++) if (masked[i] === '\n') lineStarts.push(i + 1)

  const lineOf = (offset: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const out: RawLink[] = []
  let m: RegExpExecArray | null

  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(masked))) {
    const inner = m[2]
    const pipe = inner.indexOf('|')
    const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim()
    let target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
    let anchor: string | undefined
    const hash = target.search(/[#^]/)
    if (hash > 0) {
      anchor = target.slice(hash + 1)
      target = target.slice(0, hash).trim()
    }
    if (!target) continue
    out.push({
      target,
      alias,
      anchor,
      kind: m[1] === '!' ? 'embed' : 'link',
      line: lineOf(m.index),
      from: m.index,
      to: m.index + m[0].length
    })
  }

  MDLINK_RE.lastIndex = 0
  while ((m = MDLINK_RE.exec(masked))) {
    let href: string
    try {
      href = decodeURI(m[3])
    } catch {
      href = m[3]
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue // external or in-page
    const [pathPart, anchor] = href.split('#')
    if (!pathPart) continue
    out.push({
      target: pathPart,
      alias: m[2] || undefined,
      anchor,
      kind: m[1] === '!' ? 'embed' : 'link',
      line: lineOf(m.index),
      from: m.index,
      to: m.index + m[0].length
    })
  }

  return out.sort((a, b) => a.from - b.from)
}

/**
 * Resolve a link target against the vault using the "shortest path when
 * possible" rule: an exact path wins, then a match in the linking note's own
 * folder, then the shallowest match anywhere, and only then an alias.
 *
 * Filenames beat aliases deliberately: renaming a note should not be quietly
 * overridden by an alias someone declared on an unrelated note.
 */
export function resolveLink(
  target: string,
  fromPath: string,
  allPaths: readonly string[],
  aliases?: ReadonlyMap<string, string>
): string | null {
  const t = normalizePath(target)
  const tNoExt = stripExtension(t).toLowerCase()
  const sourceDir = dirname(fromPath)

  // Relative targets like `../Notes/Thing` resolve against the source folder.
  if (t.startsWith('../') || t.startsWith('./')) {
    const parts = (sourceDir ? sourceDir.split('/') : []).concat(t.split('/'))
    const stack: string[] = []
    for (const part of parts) {
      if (part === '.' || part === '') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    const abs = stripExtension(stack.join('/')).toLowerCase()
    const hit = allPaths.find((p) => stripExtension(p).toLowerCase() === abs)
    if (hit) return hit
  }

  // A target that spells out its extension means that file and no other, so
  // `[[Note.mdx]]` cannot land on `Note.md` in a vault holding both.
  if (isMarkdownPath(t)) {
    const tLower = t.toLowerCase()
    const literal = allPaths.find((p) => p.toLowerCase() === tLower)
    if (literal) return literal
  }

  let exact: string | null = null
  let sameFolder: string | null = null
  let shallowest: string | null = null

  for (const p of allPaths) {
    const pNoExt = stripExtension(p).toLowerCase()
    if (pNoExt === tNoExt) {
      exact = p
      break
    }
    if (basename(pNoExt) !== basename(tNoExt)) continue
    if (dirname(p) === sourceDir && !sameFolder) sameFolder = p
    if (!shallowest || p.split('/').length < shallowest.split('/').length) shallowest = p
  }

  return exact ?? sameFolder ?? shallowest ?? aliases?.get(tNoExt) ?? null
}

/**
 * Map every alias and frontmatter title to the note that claims it.
 *
 * Built once per index rather than per link, since resolution runs across the
 * whole vault whenever anything changes. First claim wins, so a duplicate
 * alias does not silently flip between notes as the file list is re-read.
 */
export function buildAliasMap(
  notes: Iterable<{ path: string; title: string; aliases?: string[] }>
): Map<string, string> {
  const map = new Map<string, string>()
  for (const note of notes) {
    for (const name of [note.title, ...(note.aliases ?? [])]) {
      const key = name.trim().toLowerCase()
      if (key && !map.has(key)) map.set(key, note.path)
    }
  }
  return map
}

/* ------------------------------------------------------------ full note */

export function titleFromPath(path: string): string {
  return stripExtension(basename(path))
}

/** Rough plain text, used for excerpts, word counts and the search index. */
export function toPlainText(src: string): string {
  return src
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_m, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\r/g, '')
}

export function countWords(text: string): number {
  const m = toPlainText(text).match(/[\p{L}\p{N}'’-]+/gu)
  return m ? m.length : 0
}

/**
 * Parse one note into an index entry. Links come back unresolved (`to: null`);
 * the indexer resolves them once every path in the vault is known.
 */
export function parseNote(path: string, content: string, mtime = 0, createdAt = 0): NoteIndexEntry {
  const fm = parseFrontmatter(content)
  const headings = extractHeadings(fm.body)
  const lines = content.split('\n')

  const links: LinkRef[] = extractLinks(fm.body).map((l) => ({
    from: path,
    target: l.target,
    to: null,
    alias: l.alias,
    anchor: l.anchor,
    line: l.line,
    context: (lines[l.line] ?? '').trim(),
    kind: l.kind
  }))

  const fmTitle = typeof fm.data.title === 'string' ? fm.data.title.trim() : ''
  const plain = toPlainText(fm.body).replace(/\s+/g, ' ').trim()

  const rawAliases = fm.data.aliases ?? fm.data.alias
  const aliases = Array.isArray(rawAliases)
    ? rawAliases.map((a) => String(a).trim()).filter(Boolean)
    : typeof rawAliases === 'string' && rawAliases.trim()
      ? [rawAliases.trim()]
      : []

  return {
    path,
    title: fmTitle || headings.find((h) => h.level === 1)?.text || titleFromPath(path),
    aliases,
    mtime,
    createdAt,
    wordCount: countWords(fm.body),
    headings,
    tags: extractTags(fm.body, fm.data),
    links,
    tasks: extractTasks(fm.body),
    frontmatter: fm.data,
    excerpt: plain.slice(0, 220)
  }
}
/** Extensions Lumina treats as editable Markdown notes. */
export function isMarkdownPath(value: string): boolean {
  return /\.(?:md|markdown|mdx)$/i.test(value)
}

/** True when `path` names `parent` or one of its descendants. */
export function isPathAtOrBelow(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`)
}

/** Rebase a path when a note or an entire folder moves. */
export function rebaseDescendantPath(path: string, from: string, to: string): string {
  return path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
}

/* ------------------------------------------------- markdown link targets */

/**
 * Percent-encode a vault-relative path for use as a markdown link destination.
 *
 * CommonMark ends an unbracketed destination at the first space, so
 * `![a](attachments/my shot.png)` is not an image at all — the parser never
 * emits an `Image` node and the line renders as literal text. Attachment names
 * grow spaces easily (a screenshot's own name, and `uniquePath`'s ` 1` suffix
 * on the second paste of an `image.png`), so anything writing a target has to
 * encode it. `decodeTarget` is the inverse and the two must stay a pair.
 */
export function encodeTarget(rel: string): string {
  return normalizePath(rel)
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

/**
 * Read a markdown link destination back as a vault-relative path.
 *
 * Tolerant on purpose: notes written by hand (or by another editor) carry raw
 * spaces and unescaped `%`, and a target that is not valid percent-encoding
 * must come back unchanged rather than throw.
 */
export function decodeTarget(target: string): string {
  try {
    return normalizePath(decodeURIComponent(target))
  } catch {
    return normalizePath(target)
  }
}
