/**
 * Markdown syntax that CommonMark does not know about.
 *
 * Teaching the parser about wikilinks, tags and highlights up front means the
 * live-preview decorator can work purely from the syntax tree, instead of
 * running its own regexes over the visible text and disagreeing with the
 * indexer about what counts as a link.
 */
import type { InlineContext, MarkdownConfig } from '@lezer/markdown'
import { tags as t } from '@lezer/highlight'

const CH_HASH = 35
const CH_BANG = 33
const CH_OPEN = 91 // [
const CH_CLOSE = 93 // ]
const CH_EQUALS = 61

/** `[[Note]]`, `[[Note|alias]]` and `![[embed]]`. */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: t.link },
    { name: 'WikiLinkMark', style: t.processingInstruction },
    { name: 'WikiLinkTarget', style: t.link },
    { name: 'WikiLinkAlias', style: t.link }
  ],
  parseInline: [
    {
      name: 'WikiLink',
      parse(cx: InlineContext, next: number, pos: number): number {
        const embed = next === CH_BANG && cx.char(pos + 1) === CH_OPEN && cx.char(pos + 2) === CH_OPEN
        const plain = next === CH_OPEN && cx.char(pos + 1) === CH_OPEN
        if (!embed && !plain) return -1

        const start = pos
        const open = embed ? pos + 1 : pos
        let scan = open + 2
        let close = -1
        while (scan < cx.end - 1) {
          const c = cx.char(scan)
          if (c === 10) break // never span a line break
          if (c === CH_CLOSE && cx.char(scan + 1) === CH_CLOSE) {
            close = scan
            break
          }
          scan++
        }
        if (close === -1 || close === open + 2) return -1

        const inner = cx.slice(open + 2, close)
        const pipe = inner.indexOf('|')
        const children = [cx.elt('WikiLinkMark', start, open + 2)]

        if (pipe === -1) {
          children.push(cx.elt('WikiLinkTarget', open + 2, close))
        } else {
          children.push(cx.elt('WikiLinkTarget', open + 2, open + 2 + pipe))
          children.push(cx.elt('WikiLinkMark', open + 2 + pipe, open + 3 + pipe))
          children.push(cx.elt('WikiLinkAlias', open + 3 + pipe, close))
        }
        children.push(cx.elt('WikiLinkMark', close, close + 2))

        return cx.addElement(cx.elt('WikiLink', start, close + 2, children))
      },
      // Run before the standard link parser so `[[` is not read as `[`.
      before: 'Link'
    }
  ]
}

const isTagChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || // 0-9
  (c >= 65 && c <= 90) || // A-Z
  (c >= 97 && c <= 122) || // a-z
  c === 95 || // _
  c === 45 || // -
  c === 47 || // /
  c > 127 // accented letters and beyond

const isWordChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95

/** `#tag` and `#nested/tag`. */
export const Tag: MarkdownConfig = {
  defineNodes: [
    { name: 'HashTag', style: t.meta },
    { name: 'HashTagMark', style: t.processingInstruction },
    { name: 'HashTagLabel', style: t.meta }
  ],
  parseInline: [
    {
      name: 'HashTag',
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== CH_HASH) return -1
        // `word#notatag` is not a tag.
        if (pos > cx.offset && isWordChar(cx.char(pos - 1))) return -1

        let end = pos + 1
        while (end < cx.end && isTagChar(cx.char(end))) end++
        if (end === pos + 1) return -1

        const label = cx.slice(pos + 1, end)
        if (/^\d+$/.test(label)) return -1 // `#1` is a number
        if (label.endsWith('/')) end--

        return cx.addElement(
          cx.elt('HashTag', pos, end, [
            cx.elt('HashTagMark', pos, pos + 1),
            cx.elt('HashTagLabel', pos + 1, end)
          ])
        )
      }
    }
  ]
}

/** `==highlighted==`. */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: t.special(t.string) },
    { name: 'HighlightMark', style: t.processingInstruction }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== CH_EQUALS || cx.char(pos + 1) !== CH_EQUALS) return -1

        let scan = pos + 2
        let close = -1
        while (scan < cx.end - 1) {
          const c = cx.char(scan)
          if (c === 10) break
          if (c === CH_EQUALS && cx.char(scan + 1) === CH_EQUALS) {
            close = scan
            break
          }
          scan++
        }
        if (close === -1 || close === pos + 2) return -1

        return cx.addElement(
          cx.elt('Highlight', pos, close + 2, [
            cx.elt('HighlightMark', pos, pos + 2),
            cx.elt('HighlightMark', close, close + 2)
          ])
        )
      }
    }
  ]
}

export const luminaMarkdownExtensions = [WikiLink, Tag, Highlight]
