/** Assembles the CodeMirror extension set for one open note. */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  standardKeymap
} from '@codemirror/commands'
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import type { EditorSettings } from '@shared/types'
import { luminaEditorTheme } from './cmTheme'
import {
  insertLink,
  insertWikilink,
  toggleBullet,
  toggleHeading,
  toggleNumbered,
  toggleQuote,
  toggleTask,
  toggleWrap
} from './format'
import { livePreviewExtension } from './livePreview'
import { luminaMarkdownExtensions } from './markdownExtensions'
import { linkClickHandlers, tagCompletion, wikilinkCompletion, type ClickHandlers } from './wikilink'

/** Reconfigured in place when settings change, so the note is never reloaded. */
export const settingsCompartment = new Compartment()

export interface EditorOptions {
  path: string
  settings: EditorSettings
  handlers: ClickHandlers
  onSave: () => void
  onChange: (content: string) => void
}

/** Extensions that depend on user settings and can be swapped at runtime. */
export function settingsExtensions(path: string, settings: EditorSettings): Extension {
  return [
    livePreviewExtension(path, settings.livePreview),
    settings.showLineNumbers ? lineNumbers() : [],
    EditorView.contentAttributes.of({
      spellcheck: settings.spellcheck ? 'true' : 'false',
      // Give screen readers something better than "text box".
      'aria-label': `Note: ${path}`
    })
  ]
}

export function createExtensions(opts: EditorOptions): Extension[] {
  const { settings } = opts

  const formatKeymap = keymap.of([
    { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
    { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
    { key: 'Mod-Shift-h', run: (v) => toggleWrap(v, '==') },
    { key: 'Mod-Shift-x', run: (v) => toggleWrap(v, '~~') },
    { key: 'Mod-e', run: (v) => toggleWrap(v, '`') },
    { key: 'Mod-k', run: insertLink },
    { key: 'Mod-Shift-k', run: insertWikilink },
    { key: 'Mod-Enter', run: toggleTask },
    { key: 'Mod-Shift-q', run: toggleQuote },
    { key: 'Mod-Shift-8', run: toggleBullet },
    { key: 'Mod-Shift-7', run: toggleNumbered },
    { key: 'Mod-1', run: (v) => toggleHeading(v, 1) },
    { key: 'Mod-2', run: (v) => toggleHeading(v, 2) },
    { key: 'Mod-3', run: (v) => toggleHeading(v, 3) },
    { key: 'Mod-4', run: (v) => toggleHeading(v, 4) },
    {
      key: 'Mod-s',
      run: () => {
        opts.onSave()
        return true
      }
    },
    // Tab indents the list you are in rather than inserting a literal tab.
    { key: 'Tab', run: indentMore, shift: indentLess }
  ])

  const listKeymap = settings.smartLists
    ? keymap.of([{ key: 'Enter', run: insertNewlineContinueMarkup }])
    : []

  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    highlightSpecialChars(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),

    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: luminaMarkdownExtensions,
      addKeymap: false
    }),

    autocompletion({
      override: [wikilinkCompletion, tagCompletion],
      activateOnTyping: true,
      icons: false,
      closeOnBlur: true,
      maxRenderedOptions: 50
    }),

    settingsCompartment.of(settingsExtensions(opts.path, settings)),
    linkClickHandlers(opts.handlers),
    luminaEditorTheme,

    // Ours first so Mod-b and friends win over the defaults.
    formatKeymap,
    listKeymap,
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap]),
    keymap.of(standardKeymap),
    keymap.of(defaultKeymap),

    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.state.doc.toString())
    })
  ]
}
