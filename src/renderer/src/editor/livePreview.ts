
/**
 * Live preview: markdown that renders itself in place.
 *
 * Every marker in the document gets one of two treatments. On the line the
 * cursor is on it stays visible but dimmed, so you can always see and edit the
 * raw source. Everywhere else it is replaced out of the layout, leaving the
 * rendered result. That single rule is what makes the editor feel like a page
 * rather than a text file, while the file on disk stays plain markdown.
 *
 * The work is split across two providers because CodeMirror requires it:
 * decorations that replace content across a line break — the frontmatter strip
 * and rendered tables — must come from a state field, while a view plugin
 * handles the inline ones and gets to limit itself to the visible range.
 */
import { syntaxTree } from '@codemirror/language'
import {
  Facet,
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import {
  fallbackLinkDetails,
  linkAccentIndex,
  parseLinkUrl,
  standaloneLink,
  type LinkMetadata
} from '@shared/linkPreview'
import { parseFrontmatter, resolveLink } from '@shared/markdown-parse'
import { createIconElement, type IconName } from '../components/Icon'
import { useSettings } from '../store/settingsStore'
import { aliasMap, knownPaths } from '../store/vaultStore'
import { attachmentCandidates, isImageTarget, vaultUrl } from './resources'

/** Dispatched when the vault index changes, so link styling re-resolves. */
export const refreshPreview = StateEffect.define<null>()

/** Vault-relative path of the note in this editor, for resolving links. */
export const notePath = Facet.define<string, string>({
  combine: (values) => values[0] ?? ''
})

/** Turns the whole marker-hiding behaviour off, leaving plain source. */
export const livePreviewEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true
})

/* ---------------------------------------------------------------- shared */

/** Line numbers the caret or a selection touches; these keep raw markers. */
function activeLines(state: EditorState): Set<number> {
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) active.add(n)
  }
  return active
}

/**
 * Extent of a leading `---` frontmatter block, or null.
 *
 * The markdown parser has no concept of frontmatter, so without this the block
 * renders as a horizontal rule followed by stray `key: value` body text.
 */
function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || !/^---\s*$/.test(state.doc.line(1).text)) return -1
  for (let n = 2; n <= Math.min(state.doc.lines, 200); n++) {
    if (/^---\s*$/.test(state.doc.line(n).text)) return state.doc.line(n).to
  }
  return -1
}

/** True when the caret sits anywhere in the given line span. */
function editingLines(active: Set<number>, first: number, last: number): boolean {
  for (let n = first; n <= last; n++) if (active.has(n)) return true
  return false
}

/* ---------------------------------------------------------------- widgets */

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-list-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task-checkbox'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      const line = view.state.doc.lineAt(pos)
      const match = line.text.match(/^(\s*[-*+]\s+\[)([ xX])(\])/)
      if (!match) return
      const at = line.from + match[1].length
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-hr-widget'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
}

/**
 * Dev-only guard: a block widget's root element must never carry a margin.
 *
 * CodeMirror's height map is built from `getBoundingClientRect().height`,
 * which excludes margins, while the drawn caret comes from real DOM rects - a
 * margin desyncs the two and clicks land on the wrong line. Use padding.
 *
 * The check waits a frame because `toDOM` runs before the element is in the
 * document, where `getComputedStyle` reports nothing at all.
 */
function warnOnMargin(el: HTMLElement, widget: string): void {
  if (!import.meta.env.DEV) return
  requestAnimationFrame(() => {
    if (!el.isConnected) return
    const { marginTop, marginBottom } = getComputedStyle(el)
    if (marginTop === '0px' && marginBottom === '0px') return
    console.warn(
      `${widget} root element has a nonzero margin (${marginTop} / ${marginBottom}); ` +
        'CodeMirror height map excludes margins and clicks will land on the wrong line.'
    )
  })
}

class ImageWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly alt: string,
    readonly from: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.target === this.target && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.className = 'cm-embed-image'
    img.alt = this.alt
    img.draggable = false

    // Try each convention in turn and settle on the first that loads.
    const candidates = attachmentCandidates(this.target, this.from)
    let attempt = 0
    const next = (): void => {
      if (attempt >= candidates.length) {
        img.classList.add('is-missing')
        img.alt = `${this.alt || this.target} (not found)`
        return
      }
      img.src = vaultUrl(candidates[attempt++])
    }
    img.addEventListener('error', next)
    next()
    return img
  }
}

/**
 * The icon a wikilink's target was given in the file explorer (custom image or
 * built-in name), rendered just before the link text so a rename/re-icon in
 * the tree is visible everywhere the note is referenced, not just there.
 */
class WikilinkIconWidget extends WidgetType {
  constructor(
    readonly iconName: string | null,
    readonly customIcon: string | null
  ) {
    super()
  }
  eq(other: WikilinkIconWidget): boolean {
    return other.iconName === this.iconName && other.customIcon === this.customIcon
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-wikilink-icon'
    wrap.setAttribute('aria-hidden', 'true')
    if (this.customIcon) {
      const img = document.createElement('img')
      img.className = 'cm-wikilink-icon-img'
      img.src = vaultUrl(this.customIcon)
      img.draggable = false
      wrap.appendChild(img)
    } else if (this.iconName) {
      wrap.appendChild(createIconElement(this.iconName as IconName, 13))
    }
    return wrap
  }
}

/** A pill-styled inline replacement for `[label](https://…)` links, shown when the caret is elsewhere. */
class LinkChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string
  ) {
    super()
  }
  eq(other: LinkChipWidget): boolean {
    return other.label === this.label && other.url === this.url
  }
  toDOM(): HTMLElement {
    const el = document.createElement('a')
    el.className = 'cm-link-chip'
    el.href = this.url
    el.draggable = false
    let host = this.url
    try {
      host = new URL(this.url).hostname.replace(/^www\./, '')
    } catch {
      // Not a valid absolute URL — fall back to showing it verbatim.
    }
    const icon = document.createElement('span')
    icon.className = 'cm-link-chip-icon'
    icon.setAttribute('aria-hidden', 'true')
    el.appendChild(icon)
    const text = document.createElement('span')
    text.className = 'cm-link-chip-label'
    text.textContent = this.label && this.label !== this.url ? this.label : host
    el.appendChild(text)
    return el
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(readonly raw: string) {
    super()
  }
  eq(other: FrontmatterWidget): boolean {
    return other.raw === this.raw
  }
  toDOM(view: EditorView): HTMLElement {
    const outer = document.createElement('div')
    outer.className = 'cm-properties-outer'

    const wrap = document.createElement('div')
    wrap.className = 'cm-properties'

    // parseFrontmatter expects a newline after the closing fence.
    const { data } = parseFrontmatter(this.raw.endsWith('\n') ? this.raw : `${this.raw}\n`)
    const keys = Object.keys(data)
    if (!keys.length) wrap.classList.add('is-empty')

    for (const key of keys) {
      const row = document.createElement('div')
      row.className = 'cm-property'

      const name = document.createElement('span')
      name.className = 'cm-property-key'
      name.textContent = key
      row.appendChild(name)

      const value = document.createElement('span')
      value.className = 'cm-property-value'
      const raw = data[key]
      const items = Array.isArray(raw) ? raw : [raw]
      const isTag = key === 'tags' || key === 'tag'
      const isAlias = key === 'aliases' || key === 'alias'

      if (isTag || isAlias) {
        for (const item of items) {
          const pill = document.createElement('span')
          pill.className = isTag ? 'cm-property-tag' : 'cm-property-alias'
          pill.textContent = isTag ? `#${String(item)}` : String(item)
          value.appendChild(pill)
        }
      } else {
        value.textContent = items.map((i) => String(i)).join(', ')
      }
      row.appendChild(value)
      wrap.appendChild(row)
    }

    // Clicking the strip drops the caret into the source, so properties stay
    // editable rather than becoming a read-only decoration.
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const at = view.state.doc.lines > 1 ? view.state.doc.line(2).from : 0
      view.dispatch({ selection: { anchor: at } })
      view.focus()
    })

    outer.appendChild(wrap)

    warnOnMargin(outer, 'FrontmatterWidget')

    return outer
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** Split one markdown table row into its cells. */
function tableCells(line: string): string[] {
  return (
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      // A pipe escaped as `\|` is cell content, not a column break.
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'))
  )
}

class TableWidget extends WidgetType {
  constructor(readonly raw: string) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.raw === this.raw
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'

    const lines = this.raw.split('\n').filter((l) => l.trim() !== '')
    const table = document.createElement('table')
    table.className = 'cm-table'

    // Row two of a GFM table is the alignment spec, not data.
    const aligns = lines[1]
      ? tableCells(lines[1]).map((c) =>
          /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''
        )
      : []

    lines.forEach((line, i) => {
      if (i === 1 && aligns.length) return
      const row = document.createElement('tr')
      tableCells(line).forEach((text, col) => {
        const cell = document.createElement(i === 0 ? 'th' : 'td')
        cell.textContent = text
        if (aligns[col]) cell.style.textAlign = aligns[col]
        row.appendChild(cell)
      })
      table.appendChild(row)
    })

    wrap.appendChild(table)
    wrap.addEventListener('mousedown', (e) => {
      // Put the caret in the source so the table can still be edited by hand.
      e.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })

    warnOnMargin(wrap, 'TableWidget')

    return wrap
  }
  ignoreEvent(): boolean {
    return false
  }
}

/* -------------------------------------------------------- link banners */

/**
 * Page metadata for banner URLs, kept for the session.
 *
 * `null` means "asked and got nothing" - a failed fetch, previews turned off,
 * or a page with no metadata - and is cached like any other answer so a dead
 * link is not retried on every keystroke. The map is module-level because the
 * widgets that need it are rebuilt constantly.
 */
const linkMetaCache = new Map<string, LinkMetadata | null>()
const linkMetaPending = new Set<string>()

function requestLinkMeta(url: string, view: EditorView): void {
  if (linkMetaCache.has(url) || linkMetaPending.has(url)) return
  linkMetaPending.add(url)

  void window.lumina.links
    .preview(url)
    .then((meta) => {
      linkMetaCache.set(url, meta)
      // Rebuild so the card can pick the answer up. Dispatching straight from
      // `toDOM` would be a write during an update; this always lands later.
      try {
        view.dispatch({ effects: refreshPreview.of(null) })
      } catch {
        // The view went away while the request was in flight.
      }
    })
    .catch(() => {
      linkMetaCache.set(url, null)
    })
    .finally(() => linkMetaPending.delete(url))
}

/**
 * A link alone on its line, drawn as a card rather than a line of blue text.
 *
 * Offline it shows what the URL itself says: a site icon, the last path
 * segment as a title, and the host. With link previews turned on it also
 * carries the page's own title, description and thumbnail, which arrive later
 * through `requestLinkMeta` above.
 */
class LinkBannerWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string,
    readonly meta: LinkMetadata | null,
    readonly fetchOnDraw: boolean,
    readonly lineNumber: number
  ) {
    super()
  }

  eq(other: LinkBannerWidget): boolean {
    return (
      other.url === this.url &&
      other.label === this.label &&
      other.meta?.fetchedAt === this.meta?.fetchedAt &&
      other.fetchOnDraw === this.fetchOnDraw &&
      other.lineNumber === this.lineNumber
    )
  }

  toDOM(view: EditorView): HTMLElement {
    if (this.fetchOnDraw) requestLinkMeta(this.url, view)

    const { host } = parseLinkUrl(this.url)
    const fallback = fallbackLinkDetails(this.url)
    // Padding, never margin: CodeMirror's height map excludes margins, and a
    // block widget carrying one desyncs clicks from where the caret is drawn.
    const outer = document.createElement('div')
    outer.className = 'cm-link-banner-outer'

    const card = document.createElement('div')
    card.className = 'link-banner'
    card.dataset.accent = String(linkAccentIndex(host || this.url))
    card.setAttribute('role', 'link')
    card.title = this.url

    const grip = document.createElement('span')
    grip.className = 'link-banner-grip'
    grip.draggable = true
    grip.setAttribute('role', 'button')
    grip.setAttribute('aria-label', 'Drag to reorder link')
    grip.title = 'Drag to reorder'
    grip.textContent = '⠿'
    grip.addEventListener('mousedown', (event) => event.stopPropagation())
    grip.addEventListener('dragstart', (event) => {
      event.stopPropagation()
      event.dataTransfer?.setData('text/lumina-link-line', String(this.lineNumber))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      card.classList.add('is-dragging')
    })
    grip.addEventListener('dragend', () => card.classList.remove('is-dragging'))
    card.appendChild(grip)

    const mark = document.createElement('div')
    mark.className = 'link-banner-mark'
    mark.appendChild(createIconElement('globe', 22, 'link-banner-glyph'))
    if (this.meta?.imagePath) {
      const thumb = document.createElement('img')
      thumb.className = 'link-banner-thumb'
      thumb.src = vaultUrl(this.meta.imagePath)
      thumb.alt = ''
      thumb.draggable = false
      // A thumbnail that will not load leaves the site icon behind it.
      thumb.addEventListener('error', () => thumb.remove())
      mark.appendChild(thumb)
    }
    card.appendChild(mark)

    const body = document.createElement('div')
    body.className = 'link-banner-body'

    const title = document.createElement('div')
    title.className = 'link-banner-title'
    title.textContent = this.label || this.meta?.title || fallback.title
    body.appendChild(title)

    const descriptionText = this.meta?.description || fallback.description
    if (descriptionText) {
      const description = document.createElement('div')
      description.className = 'link-banner-desc'
      description.textContent = descriptionText
      body.appendChild(description)
    }

    const source = document.createElement('div')
    source.className = 'link-banner-host'
    source.textContent = host || this.url
    body.appendChild(source)

    card.appendChild(body)

    const openIcon = document.createElement('span')
    openIcon.className = 'link-banner-open'
    openIcon.setAttribute('aria-hidden', 'true')
    openIcon.appendChild(createIconElement('external', 14))
    card.appendChild(openIcon)

    card.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      void window.lumina.files.openExternal(this.url)
    })
    card.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('text/lumina-link-line')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      card.classList.add('is-drop-target')
    })
    card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'))
    card.addEventListener('drop', (event) => {
      card.classList.remove('is-drop-target')
      const source = Number(event.dataTransfer?.getData('text/lumina-link-line'))
      if (!Number.isInteger(source) || source === this.lineNumber) return
      event.preventDefault()
      event.stopPropagation()
      const lines = view.state.doc.toString().split('\n')
      const [moved] = lines.splice(source - 1, 1)
      const target = this.lineNumber - 1 - (source < this.lineNumber ? 1 : 0)
      lines.splice(target, 0, moved)
      const next = lines.join('\n')
      const anchor = lines.slice(0, target).reduce((sum, line) => sum + line.length + 1, 0)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor } })
      view.focus()
    })

    // Clicking the gap around the card puts the caret on the line instead, so
    // the raw markdown is still reachable with the mouse.
    outer.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(outer) } })
      view.focus()
    })

    outer.appendChild(card)

    warnOnMargin(outer, 'LinkBannerWidget')

    return outer
  }

  ignoreEvent(): boolean {
    return false
  }
}

/* ---------------------------------------------------- block decorations */

/**
 * Decorations that swallow line breaks, which only a state field may provide.
 *
 * Both of these swap back to raw source the moment the caret lands inside, so
 * nothing here is a one-way rendering.
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
  if (!state.facet(livePreviewEnabled)) return Decoration.none

  const active = activeLines(state)
  const ranges: Range<Decoration>[] = []

  const fmEnd = frontmatterEnd(state)
  if (fmEnd > 0 && !editingLines(active, 1, state.doc.lineAt(fmEnd).number)) {
    ranges.push(
      Decoration.replace({
        widget: new FrontmatterWidget(state.sliceDoc(0, fmEnd)),
        block: true
      }).range(0, fmEnd)
    )
  }

  const wantsMetadata = useSettings.getState().settings.editor.linkPreviews
  const bannerLines = new Set<number>()

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const first = state.doc.lineAt(node.from).number
        const last = state.doc.lineAt(node.to).number
        if (editingLines(active, first, last)) return false

        ranges.push(
          Decoration.replace({
            widget: new TableWidget(state.sliceDoc(node.from, node.to)),
            block: true
          }).range(state.doc.line(first).from, state.doc.line(last).to)
        )
        return false
      }

      // A link that is the whole line becomes a card. Walking the tree rather
      // than the raw lines is what keeps a URL inside a fenced code block out
      // of it: there the text is `CodeText`, never a link node.
      if (node.name !== 'Link' && node.name !== 'URL' && node.name !== 'Autolink') return

      const line = state.doc.lineAt(node.from)
      if (bannerLines.has(line.number) || line.from < fmEnd) return false

      const link = standaloneLink(line.text)
      if (!link) return false
      if (editingLines(active, line.number, line.number)) return false

      bannerLines.add(line.number)
      ranges.push(
        Decoration.replace({
          widget: new LinkBannerWidget(
            link.label,
            link.url,
            linkMetaCache.get(link.url) ?? null,
            wantsMetadata && !linkMetaCache.has(link.url),
            line.number
          ),
          block: true
        }).range(line.from, line.to)
      )
      return false
    }
  })

  return ranges.length ? RangeSet.of(ranges, true) : Decoration.none
}

const blockPreviewField = StateField.define<DecorationSet>({
  create: (state) => buildBlockDecorations(state),
  update(value, tr) {
    // Selection matters as much as content here: moving the caret into a table
    // or the frontmatter is what brings the source back. Parsing is
    // incremental, so a tree that grew since the last pass counts too —
    // otherwise a table below the fold never renders until something else
    // happens to invalidate the field.
    const reparsed = syntaxTree(tr.startState) !== syntaxTree(tr.state)
    if (
      tr.docChanged ||
      tr.selection ||
      reparsed ||
      tr.effects.some((e) => e.is(refreshPreview))
    ) {
      return buildBlockDecorations(tr.state)
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field)
})

/* --------------------------------------------------- inline decorations */

const HIDDEN = Decoration.replace({})
const MARK_DIM = Decoration.mark({ class: 'cm-md-mark' })

/**
 * Callout type -> semantic colour. An empty string means the plain callout,
 * which takes the accent — the clay orange the rest of the app is built on.
 * `note` is the default type a callout gets when it names nothing else, so it
 * belongs there rather than in the blue `info` group.
 */
const CALLOUT_TYPES: Record<string, string> = {
  note: '',
  info: 'info',
  todo: 'info',
  abstract: 'info',
  summary: 'info',
  tip: 'success',
  hint: 'success',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'warning',
  help: 'warning',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  failure: 'danger',
  fail: 'danger',
  quote: '',
  cite: '',
  example: ''
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const enabled = state.facet(livePreviewEnabled)
  const from = state.facet(notePath)
  const ranges: Range<Decoration>[] = []

  const active = activeLines(state)
  const fmEnd = frontmatterEnd(state)

  const isRaw = (pos: number): boolean => !enabled || active.has(state.doc.lineAt(pos).number)

  /** Hide a span, or dim it when its line is being edited. */
  const conceal = (start: number, end: number): void => {
    if (end <= start) return
    if (isRaw(start)) ranges.push(MARK_DIM.range(start, end))
    else ranges.push(HIDDEN.range(start, end))
  }

  const lineClass = (pos: number, cls: string): void => {
    ranges.push(Decoration.line({ class: cls }).range(state.doc.lineAt(pos).from))
  }

  const paths = knownPaths()
  const aliases = aliasMap()

  const tree = syntaxTree(state)

  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        const name = node.name
        const start = node.from
        const end = node.to

        // Spans wholly inside the frontmatter belong to the properties strip.
        // Straddling nodes (the document root, for one) still need descending
        // into, so only the fully-contained ones stop the walk.
        if (fmEnd > 0 && start < fmEnd) {
          if (end <= fmEnd) return false
          return undefined
        }

        /* headings ----------------------------------------------------- */
        const heading = name.match(/^ATXHeading(\d)$/)
        if (heading) {
          ranges.push(Decoration.mark({ class: `cm-heading cm-h${heading[1]}` }).range(start, end))
          return undefined
        }
        if (name === 'HeaderMark') {
          // Swallow the space after `##` too, so the title starts at the margin.
          let stop = end
          while (stop < state.doc.length && state.sliceDoc(stop, stop + 1) === ' ') stop++
          conceal(start, stop)
          return undefined
        }

        /* inline emphasis ---------------------------------------------- */
        if (name === 'StrongEmphasis') {
          ranges.push(Decoration.mark({ class: 'cm-strong' }).range(start, end))
          return undefined
        }
        if (name === 'Emphasis') {
          ranges.push(Decoration.mark({ class: 'cm-em' }).range(start, end))
          return undefined
        }
        if (name === 'Strikethrough') {
          ranges.push(Decoration.mark({ class: 'cm-strike' }).range(start, end))
          return undefined
        }
        if (name === 'Highlight') {
          ranges.push(Decoration.mark({ class: 'cm-highlight' }).range(start, end))
          return undefined
        }
        if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'HighlightMark') {
          conceal(start, end)
          return undefined
        }

        /* code ---------------------------------------------------------- */
        if (name === 'InlineCode') {
          ranges.push(Decoration.mark({ class: 'cm-inline-code' }).range(start, end))
          return undefined
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          const first = state.doc.lineAt(start).number
          const last = state.doc.lineAt(end).number
          for (let n = first; n <= last; n++) {
            const classes = ['cm-code-block']
            if (n === first) classes.push('cm-code-block-first')
            if (n === last) classes.push('cm-code-block-last')
            ranges.push(Decoration.line({ class: classes.join(' ') }).range(state.doc.line(n).from))
          }
          return undefined
        }
        if (name === 'CodeMark' || name === 'CodeInfo') {
          conceal(start, end)
          return undefined
        }

        /* quotes and callouts ------------------------------------------- */
        if (name === 'Blockquote') {
          const first = state.doc.lineAt(start)
          const callout = first.text.match(/^\s*>\s*\[!([A-Za-z]+)\]([+-]?)\s*(.*)$/)
          const lastLine = state.doc.lineAt(end).number

          for (let n = first.number; n <= lastLine; n++) {
            const line = state.doc.line(n)
            if (callout) {
              const kind = CALLOUT_TYPES[callout[1].toLowerCase()] ?? ''
              const classes = ['cm-callout']
              if (kind) classes.push(`type-${kind}`)
              if (n === first.number) {
                classes.push('cm-callout-first')
                ranges.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
              } else {
                classes.push('cm-callout-body')
                if (n === first.number + 1) classes.push('cm-callout-body-first')
                if (n === lastLine) classes.push('cm-callout-last')
                ranges.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
              }
            } else {
              ranges.push(Decoration.line({ class: 'cm-quote' }).range(line.from))
            }
          }

          if (callout) {
            // Hide the `[!type]` token and bold whatever title follows it.
            const markerStart = first.from + first.text.indexOf('[!')
            const markerEnd = markerStart + callout[1].length + 3 + (callout[2] ? 1 : 0)
            conceal(markerStart, Math.min(markerEnd, first.to))
            if (callout[3]) {
              const titleFrom = first.to - callout[3].length
              ranges.push(
                Decoration.mark({ class: 'cm-callout-title' }).range(titleFrom, first.to)
              )
            }
          }
          return undefined
        }
        if (name === 'QuoteMark') {
          conceal(start, Math.min(end + 1, state.doc.lineAt(start).to))
          return undefined
        }

        /* rules and lists ----------------------------------------------- */
        if (name === 'HorizontalRule') {
          lineClass(start, 'cm-hr-line')
          if (!isRaw(start)) {
            ranges.push(Decoration.replace({ widget: new HrWidget() }).range(start, end))
          }
          return undefined
        }
        if (name === 'ListMark') {
          const text = state.sliceDoc(start, end)
          if (/^[-*+]$/.test(text) && !isRaw(start)) {
            ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(start, end))
          } else {
            ranges.push(MARK_DIM.range(start, end))
          }
          return undefined
        }
        if (name === 'TaskMarker') {
          const checked = /[xX]/.test(state.sliceDoc(start, end))
          ranges.push(
            Decoration.replace({ widget: new CheckboxWidget(checked) }).range(start, end)
          )
          if (checked) {
            const line = state.doc.lineAt(start)
            if (end < line.to) {
              ranges.push(Decoration.mark({ class: 'cm-task-done' }).range(end, line.to))
            }
          }
          return undefined
        }

        /* wikilinks ------------------------------------------------------ */
        if (name === 'WikiLink') {
          const inner = state.sliceDoc(start, end).replace(/^!?\[\[|\]\]$/g, '')
          const target = inner.split('|')[0].split('#')[0].trim()
          const embed = state.sliceDoc(start, start + 1) === '!'

          if (embed && isImageTarget(target) && !isRaw(start)) {
            const alias = inner.includes('|') ? inner.split('|')[1] : ''
            ranges.push(
              Decoration.replace({ widget: new ImageWidget(target, alias, from) }).range(start, end)
            )
            return false
          }

          const resolved = resolveLink(target, from, paths, aliases)
          const overrides = useSettings.getState().settings
          const color = resolved ? overrides.colorOverrides[resolved] : undefined
          const iconName = resolved ? overrides.iconOverrides[resolved] : undefined
          const customIcon = resolved ? overrides.customIcons[resolved] : undefined

          ranges.push(
            Decoration.mark({
              class: resolved ? 'cm-wikilink' : 'cm-wikilink unresolved',
              attributes: color ? { style: `color: ${color}` } : undefined
            }).range(start, end)
          )
          // The icon sits just before the visible link text — same rule as
          // everything else in live preview, it disappears when the caret is on
          // this line so the raw `[[...]]` source is what you actually edit.
          if (!isRaw(start) && (iconName || customIcon)) {
            ranges.push(
              Decoration.widget({
                widget: new WikilinkIconWidget(iconName ?? null, customIcon ?? null),
                side: -1
              }).range(start)
            )
          }
          return undefined
        }
        if (name === 'WikiLinkMark') {
          conceal(start, end)
          return undefined
        }
        if (name === 'WikiLinkTarget') {
          // With an alias present the target itself is noise; hide it.
          const parent = node.node.parent
          const hasAlias = parent ? state.sliceDoc(parent.from, parent.to).includes('|') : false
          if (hasAlias) conceal(start, end)
          return undefined
        }

        /* markdown links and images -------------------------------------- */
        if (name === 'Image') {
          if (isRaw(start)) return undefined
          const text = state.sliceDoc(start, end)
          const m = text.match(/^!\[([^\]]*)\]\(([^)\s]+)/)
          if (m && !/^[a-z][a-z0-9+.-]*:/i.test(m[2])) {
            ranges.push(
              Decoration.replace({ widget: new ImageWidget(m[2], m[1], from) }).range(start, end)
            )
            return false
          }
          return undefined
        }
        if (name === 'Link') {
          if (isRaw(start)) {
            ranges.push(Decoration.mark({ class: 'cm-mdlink' }).range(start, end))
            return undefined
          }
          const text = state.sliceDoc(start, end)
          const m = text.match(/^\[([^\]]*)\]\((\S+)\)$/)
          if (m && /^https?:\/\//i.test(m[2])) {
            ranges.push(
              Decoration.replace({ widget: new LinkChipWidget(m[1], m[2]), inclusive: false }).range(
                start,
                end
              )
            )
            return false
          }
          ranges.push(Decoration.mark({ class: 'cm-mdlink' }).range(start, end))
          const close = text.indexOf('](')
          if (close > 0) {
            conceal(start, start + 1) // the opening bracket
            conceal(start + close, end) // everything from `](` onwards
          }
          return undefined
        }

        /* tags ------------------------------------------------------------ */
        if (name === 'HashTag') {
          ranges.push(Decoration.mark({ class: 'cm-tag' }).range(start, end))
          return undefined
        }

        /* tables ---------------------------------------------------------- */
        if (name === 'Table') {
          const first = state.doc.lineAt(start).number
          const last = state.doc.lineAt(end).number

          // When the block field has replaced this table with a rendered one,
          // decorating the source underneath would only fight with it.
          if (enabled && !editingLines(active, first, last)) return false

          for (let n = first; n <= last; n++) {
            ranges.push(Decoration.line({ class: 'cm-table-line' }).range(state.doc.line(n).from))
          }
          return undefined
        }

        return undefined
      }
    })
  }

  return ranges.length ? RangeSet.of(ranges, true) : Decoration.none
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      const refreshed = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(refreshPreview))
      )
      if (update.docChanged || update.viewportChanged || update.selectionSet || refreshed) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

/* ------------------------------------------------------- callout sizing */

/**
 * A callout's box is only as wide as its widest body line, so every line below
 * the title has to be given that same width — otherwise a short last line sits
 * in a visibly narrower box than the sentence above it.
 *
 * The width can only be read off the laid-out DOM. The raw source is a bad
 * proxy for it: `> ` markers are hidden, inline code renders in the mono font
 * at a different size, wikilinks lose their brackets. So this runs as a
 * CodeMirror measure pass and writes `--callout-width` straight onto the line
 * elements, rather than guessing at decoration time.
 */
type CalloutGroup = { lines: HTMLElement[]; width: number }

/**
 * Width of a line's rendered text, independent of the box it sits in — a
 * `Range` over the contents ignores the `min-width` a previous pass applied,
 * which measuring the element itself would feed back into.
 */
function renderedWidth(line: HTMLElement): number {
  const range = document.createRange()
  range.selectNodeContents(line)
  const text = range.getBoundingClientRect().width
  if (!text) return 0
  const style = getComputedStyle(line)
  // Lines are `border-box`, so `min-width` has to cover the padding as well.
  return Math.ceil(text + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight))
}

function measureCallouts(view: EditorView): CalloutGroup[] {
  const groups: CalloutGroup[] = []
  let current: CalloutGroup | null = null

  for (const child of Array.from(view.contentDOM.children)) {
    const line = child as HTMLElement
    if (line.classList.contains('cm-callout-body')) {
      // A callout whose title line is scrolled out of the viewport has no
      // `cm-callout-first` to open the group, so open one here too.
      if (!current) {
        current = { lines: [], width: 0 }
        groups.push(current)
      }
      current.lines.push(line)
      current.width = Math.max(current.width, renderedWidth(line))
    } else {
      current = line.classList.contains('cm-callout-first') ? { lines: [], width: 0 } : null
      if (current) groups.push(current)
    }
  }

  return groups.filter((g) => g.lines.length > 0)
}

const calloutWidthPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.schedule(view)
    }

    update(update: ViewUpdate): void {
      // Deliberately unconditional. The width lives in an inline style rather
      // than in the decoration, so any redraw that rebuilds a line's DOM drops
      // it — and a redraw does not have to touch the doc, the selection or the
      // geometry to happen. A `refreshPreview` effect (dispatched when the
      // vault index lands, moments after a note opens) rebuilds every
      // decoration and re-renders the callout lines with none of those flags
      // set, which is why filtering on them left the box unsized until the
      // first click. Re-measuring is viewport-bounded and deduplicated by the
      // request key, so running it on every update is cheap.
      this.schedule(update.view)
    }

    schedule(view: EditorView): void {
      view.requestMeasure({
        key: 'lumina-callout-width',
        read: measureCallouts,
        write: (groups, v) => {
          // Line elements are recycled, so clear every line first rather than
          // leaving a stale width on one that is no longer part of a callout.
          for (const child of Array.from(v.contentDOM.children)) {
            ;(child as HTMLElement).style.removeProperty('--callout-width')
          }
          for (const group of groups) {
            for (const line of group.lines) {
              line.style.setProperty('--callout-width', `${group.width}px`)
            }
          }
        }
      })
    }
  }
)

export function livePreviewExtension(path: string, enabled: boolean): Extension {
  return [
    notePath.of(path),
    livePreviewEnabled.of(enabled),
    blockPreviewField,
    livePreviewPlugin,
    calloutWidthPlugin
  ]
}
