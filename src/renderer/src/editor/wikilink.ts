/** Wikilink autocomplete and click-to-follow. */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { basename, resolveLink, stripExtension } from '@shared/markdown-parse'
import { aliasMap, useVault } from '../store/vaultStore'

/**
 * Suggest notes after `[[`.
 *
 * Ranking puts title matches ahead of path matches and prefixes ahead of
 * substrings, so typing a few letters of a note you use daily surfaces it
 * first even in a vault where the string appears in fifty folder names.
 */
export function wikilinkCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[[^\]\n|#]*/)
  if (!before) return null
  if (before.from === before.to && !context.explicit) return null

  const query = before.text.slice(2).toLowerCase()
  const { notes } = useVault.getState().index

  const scored: { completion: Completion; score: number }[] = []
  for (const [path, entry] of Object.entries(notes)) {
    const title = entry.title
    const lowerTitle = title.toLowerCase()
    const lowerPath = path.toLowerCase()

    let score: number
    if (!query) score = 0
    else if (lowerTitle.startsWith(query)) score = 4
    else if (lowerTitle.includes(query)) score = 3
    else if (basename(lowerPath).startsWith(query)) score = 2
    else if (lowerPath.includes(query)) score = 1
    else continue

    scored.push({
      completion: {
        label: title,
        // The link stores the path when the title alone would be ambiguous.
        apply: linkTargetFor(path, title),
        detail: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
        type: 'text'
      },
      score
    })
  }

  scored.sort((a, b) => b.score - a.score || a.completion.label.localeCompare(b.completion.label))
  const options = scored.slice(0, 50).map((s) => s.completion)

  if (query.trim()) {
    options.push({
      label: query,
      detail: 'New note',
      apply: query,
      type: 'keyword',
      boost: -99
    })
  }

  return {
    from: before.from + 2,
    options,
    validFor: /^[^\]\n|#]*$/
  }
}

/**
 * Write the shortest target that still points back at this note.
 *
 * Preferring the bare name keeps links readable, but only when resolution
 * agrees; otherwise the full path goes in so the link cannot drift onto a
 * same-named note elsewhere in the vault.
 */
function linkTargetFor(path: string, title: string): string {
  const paths = Object.keys(useVault.getState().index.notes)
  const aliases = aliasMap()
  const short = stripExtension(basename(path))
  if (resolveLink(short, path, paths, aliases) === path) return short
  if (resolveLink(title, path, paths, aliases) === path) return title
  return stripExtension(path)
}

/** Suggest existing tags after `#`. */
export function tagCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/#[\w/-]*/)
  if (!before) return null
  // A `#` at the start of a line is a heading, not a tag.
  const line = context.state.doc.lineAt(before.from)
  if (before.from === line.from) return null
  if (before.from === before.to && !context.explicit) return null

  const tags = Object.keys(useVault.getState().index.tags)
  if (!tags.length) return null

  return {
    from: before.from + 1,
    options: tags.sort().map((tag) => ({
      label: tag,
      detail: `${useVault.getState().index.tags[tag].length}`,
      type: 'keyword'
    })),
    validFor: /^[\w/-]*$/
  }
}

/* ---------------------------------------------------------------- clicks */

export type ClickTarget =
  | { kind: 'note'; target: string; anchor?: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'url'; url: string }

/** What, if anything, is clickable at this document position. */
export function targetAt(view: EditorView, pos: number): ClickTarget | null {
  let node = syntaxTree(view.state).resolveInner(pos, 1)

  while (node) {
    if (node.name === 'WikiLink') {
      const raw = view.state.sliceDoc(node.from, node.to).replace(/^!?\[\[/, '').replace(/\]\]$/, '')
      const target = raw.split('|')[0]
      const [path, anchor] = target.split(/[#^]/)
      if (!path.trim()) return null
      return { kind: 'note', target: path.trim(), anchor }
    }
    if (node.name === 'HashTag') {
      return { kind: 'tag', tag: view.state.sliceDoc(node.from, node.to).replace(/^#/, '') }
    }
    if (node.name === 'Link') {
      const text = view.state.sliceDoc(node.from, node.to)
      const m = text.match(/\]\(([^)\s]+)/)
      if (!m) return null
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) return { kind: 'url', url: m[1] }
      const [path, anchor] = m[1].split('#')
      return { kind: 'note', target: decodeURI(path), anchor }
    }
    const parent = node.parent
    if (!parent) break
    node = parent
  }
  return null
}

export interface ClickHandlers {
  openNote: (target: string, opts: { newTab: boolean; anchor?: string }) => void
  openTag: (tag: string) => void
  openUrl: (url: string) => void
}

/**
 * Follow a link on plain click, the way Obsidian does.
 *
 * The handler only fires on elements the live-preview plugin marked as links,
 * so clicking ordinary prose still just places the caret.
 */
export function linkClickHandlers(handlers: ClickHandlers): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false
      const el = (event.target as HTMLElement | null)?.closest(
        '.cm-wikilink, .cm-mdlink, .cm-tag'
      )
      if (!el) return false

      const pos = view.posAtDOM(el)
      const target = targetAt(view, pos)
      if (!target) return false

      event.preventDefault()
      if (target.kind === 'note') {
        handlers.openNote(target.target, {
          newTab: event.ctrlKey || event.metaKey,
          anchor: target.anchor
        })
      } else if (target.kind === 'tag') {
        handlers.openTag(target.tag)
      } else {
        handlers.openUrl(target.url)
      }
      return true
    }
  })
}
