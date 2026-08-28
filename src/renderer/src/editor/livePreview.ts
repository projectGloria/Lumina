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
import { parseFrontmatter, resolveLink } from '@shared/markdown-parse'
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

class FrontmatterWidget extends WidgetType {
  constructor(readonly raw: string) {
    super()
  }
  eq(other: FrontmatterWidget): boolean {
    return other.raw === this.raw
  }
  toDOM(view: EditorView): HTMLElement {
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

    return wrap
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
    return wrap
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

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
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

const CALLOUT_TYPES: Record<string, string> = {
  note: 'info',
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
  const linkClass = (target: string): string =>
    resolveLink(target, from, paths, aliases) ? 'cm-wikilink' : 'cm-wikilink unresolved'

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
              if (n === first.number) classes.push('cm-callout-first')
              if (n === lastLine) classes.push('cm-callout-last')
              ranges.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
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
          ranges.push(Decoration.mark({ class: linkClass(target) }).range(start, end))
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
          ranges.push(Decoration.mark({ class: 'cm-mdlink' }).range(start, end))
          if (isRaw(start)) return undefined
          const text = state.sliceDoc(start, end)
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

export function livePreviewExtension(path: string, enabled: boolean): Extension {
  return [
    notePath.of(path),
    livePreviewEnabled.of(enabled),
    blockPreviewField,
    livePreviewPlugin
  ]
}
