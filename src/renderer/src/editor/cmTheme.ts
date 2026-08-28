/**
 * CodeMirror theming.
 *
 * Layout and typography live in `markdown.css`; what remains here is the token
 * colouring for embedded code blocks, plus the few surfaces CodeMirror styles
 * inline. Every colour is a token, so themes reach the editor too.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const codeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--lum-accent)' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: 'var(--lum-accent)', fontWeight: '600' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: 'var(--lum-text)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--lum-info)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--lum-warning)' },
  { tag: [t.definition(t.name), t.separator], color: 'var(--lum-text)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--lum-warning)' },
  { tag: [t.number, t.integer, t.float, t.bool], color: 'var(--lum-warning)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--lum-success)' },
  { tag: [t.meta, t.comment], color: 'var(--lum-text-faint)', fontStyle: 'italic' },
  { tag: t.operator, color: 'var(--lum-text-muted)' },
  { tag: t.invalid, color: 'var(--lum-danger)' },
  { tag: t.link, color: 'var(--lum-link)' },
  // The markdown document itself is styled by the live-preview classes, so
  // these only apply inside fenced code.
  { tag: t.strong, fontWeight: '680' },
  { tag: t.emphasis, fontStyle: 'italic' }
])

const base = EditorView.theme({
  '&': {
    color: 'var(--lum-text)',
    backgroundColor: 'var(--lum-bg)'
  },
  '.cm-scroller': {
    fontFamily: 'inherit'
  },
  '.cm-placeholder': {
    color: 'var(--lum-text-faint)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--lum-surface)',
    borderColor: 'var(--lum-border)',
    color: 'var(--lum-text)'
  },
  '.cm-panel': {
    backgroundColor: 'var(--lum-bg-sidebar)',
    color: 'var(--lum-text)'
  },
  '.cm-panel input, .cm-panel button': {
    fontFamily: 'var(--lum-font-ui)'
  },
  '.cm-hr-widget': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--lum-hr)'
  },
  '.cm-embed-image.is-missing': {
    display: 'inline-block',
    padding: '8px 12px',
    border: '1px dashed var(--lum-border-strong)',
    color: 'var(--lum-text-faint)',
    borderRadius: 'var(--lum-radius-sm)'
  }
})

export const luminaEditorTheme: Extension = [base, syntaxHighlighting(codeHighlight)]
