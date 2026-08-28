/** Text transforms behind the formatting commands and their shortcuts. */
import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import { EditorView as EditorViewRef, type EditorView } from '@codemirror/view'

/**
 * Wrap or unwrap the selection with a marker such as `**`.
 *
 * With nothing selected it wraps the word under the cursor, which is what you
 * want when you reach for Ctrl+B mid-word.
 */
export function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view

  const selection = state.changeByRange((range) => {
    let { from, to } = range

    if (from === to) {
      const line = state.doc.lineAt(from)
      const text = line.text
      let start = from - line.from
      let end = start
      while (start > 0 && /[\w'’-]/.test(text[start - 1])) start--
      while (end < text.length && /[\w'’-]/.test(text[end])) end++
      if (start !== end) {
        from = line.from + start
        to = line.from + end
      }
    }

    const before = state.sliceDoc(Math.max(0, from - marker.length), from)
    const after = state.sliceDoc(to, Math.min(state.doc.length, to + marker.length))

    if (before === marker && after === marker) {
      return {
        changes: [
          { from: from - marker.length, to: from },
          { from: to, to: to + marker.length }
        ],
        range: EditorSelection.range(from - marker.length, to - marker.length)
      }
    }

    const inner = state.sliceDoc(from, to)
    if (inner.startsWith(marker) && inner.endsWith(marker) && inner.length > marker.length * 2) {
      return {
        changes: [
          { from, to: from + marker.length },
          { from: to - marker.length, to }
        ],
        range: EditorSelection.range(from, to - marker.length * 2)
      }
    }

    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker }
      ],
      range: EditorSelection.range(from + marker.length, to + marker.length)
    }
  })

  view.dispatch(selection, { scrollIntoView: true })
  view.focus()
  return true
}

/** Add, swap or remove a line prefix like `## ` or `> `. */
export function toggleLinePrefix(view: EditorView, prefix: string, pattern: RegExp): boolean {
  const { state } = view
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const match = line.text.match(pattern)
      if (match && match[0] === prefix) {
        changes.push({ from: line.from, to: line.from + match[0].length })
      } else if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: prefix })
      } else {
        changes.push({ from: line.from, insert: prefix })
      }
    }
  }

  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
  return true
}

export const toggleHeading = (view: EditorView, level: number): boolean =>
  toggleLinePrefix(view, `${'#'.repeat(level)} `, /^#{1,6}\s+/)

export const toggleQuote = (view: EditorView): boolean =>
  toggleLinePrefix(view, '> ', /^>\s?/)

export const toggleBullet = (view: EditorView): boolean =>
  toggleLinePrefix(view, '- ', /^\s*[-*+]\s+/)

export const toggleNumbered = (view: EditorView): boolean =>
  toggleLinePrefix(view, '1. ', /^\s*\d+\.\s+/)

/** Turn the current lines into tasks, or tick and untick existing ones. */
export function toggleTask(view: EditorView): boolean {
  const { state } = view
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const task = line.text.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s?)/)
      if (task) {
        const at = line.from + task[1].length
        changes.push({ from: at, to: at + 1, insert: task[2] === ' ' ? 'x' : ' ' })
        continue
      }
      const bullet = line.text.match(/^(\s*)([-*+]\s+)/)
      if (bullet) {
        const at = line.from + bullet[0].length
        changes.push({ from: at, insert: '[ ] ' })
      } else {
        changes.push({ from: line.from, insert: '- [ ] ' })
      }
    }
  }

  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
  return true
}

/** Wrap the selection in a markdown link, leaving the cursor in the target. */
export function insertLink(view: EditorView): boolean {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      const insert = `[${text}]()`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length - 1)
      }
    }),
    { scrollIntoView: true }
  )
  view.focus()
  return true
}

/** Insert `[[]]` and put the cursor inside so autocomplete fires. */
export function insertWikilink(view: EditorView): boolean {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      const insert = `[[${text}]]`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + 2 + text.length)
      }
    }),
    { scrollIntoView: true }
  )
  view.focus()
  return true
}

export function insertText(view: EditorView, text: string): void {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + text.length)
    })),
    { scrollIntoView: true }
  )
  view.focus()
}

/** Move the cursor to a line and centre it, used by search and outline. */
export function revealLine(view: EditorView, line: number): void {
  const target = Math.max(1, Math.min(view.state.doc.lines, line + 1))
  const pos = view.state.doc.line(target).from
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    // Centring keeps the match off the very bottom edge of the viewport.
    effects: EditorViewRef.scrollIntoView(pos, { y: 'center' })
  })
  view.focus()
}
