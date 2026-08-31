/** Assembles the CodeMirror extension set for one open note. */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus
} from '@codemirror/autocomplete'
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
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding
} from '@codemirror/view'
import type { EditorSettings } from '@shared/types'
import { attachmentDropExtension } from './attachments'
import { luminaEditorTheme } from './cmTheme'
import { editorContextMenu } from './contextMenu'
import { linkPasteExtension } from './linkPaste'
import { livePreviewExtension } from './livePreview'
import { luminaMarkdownExtensions } from './markdownExtensions'
import { setActiveView } from './activeView'
import { linkClickHandlers, tagCompletion, wikilinkCompletion, type ClickHandlers } from './wikilink'
import { slashCompletion } from './slashCommands'
import { COMMANDS, hotkeyFor, runCommand } from '../lib/commands'
import { translateAccelerator } from '../lib/hotkeys'

/** Reconfigured in place when settings change, so the note is never reloaded. */
export const settingsCompartment = new Compartment()

/**
 * Reconfigured whenever `settings.hotkeys` changes, so a rebound Editor-section
 * command takes effect in the editor without reloading the note.
 */
export const formatKeymapCompartment = new Compartment()

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
    // Sits here rather than in the static set so toggling the preference takes
    // effect on the open note. It is ahead of `standardKeymap` in the array, so
    // list continuation still wins over the default Enter.
    settings.smartLists
      ? keymap.of([
          {
            key: 'Enter',
            // Yield to an open completion popup (e.g. accepting a wikilink) —
            // otherwise Enter always continues the list markup instead.
            run: (v) => (completionStatus(v.state) === 'active' ? false : insertNewlineContinueMarkup(v))
          }
        ])
      : [],
    EditorView.contentAttributes.of({
      spellcheck: settings.spellcheck ? 'true' : 'false',
      // Give screen readers something better than "text box".
      'aria-label': `Note: ${path}`
    })
  ]
}

/**
 * The editor's own keymap, derived from the `Editor`-section entries in the
 * command registry rather than a second hardcoded list — this is what makes
 * rebinding a format command in Settings > Hotkeys actually take effect while
 * typing, and it is reconfigured whenever `settings.hotkeys` changes.
 *
 * `Mod-s` and `Tab` stay outside the registry: save needs this editor
 * instance's own `onSave` closure, and Tab-to-indent isn't a palette command.
 */
export function buildFormatKeymap(onSave: () => void): Extension {
  const bindings: KeyBinding[] = []
  for (const command of COMMANDS) {
    if (command.section !== 'Editor') continue
    const key = translateAccelerator(hotkeyFor(command))
    if (!key) continue
    bindings.push({
      key,
      run: () => {
        runCommand(command.id)
        return true
      }
    })
  }

  bindings.push({
    key: 'Mod-s',
    run: () => {
      onSave()
      return true
    }
  })
  // Tab indents the list you are in rather than inserting a literal tab.
  bindings.push({ key: 'Tab', run: indentMore, shift: indentLess })

  // Beats CodeMirror's own built-ins (e.g. searchKeymap's Mod-d) regardless of
  // extension order, so a rebound or newly-added Editor command always wins.
  return Prec.highest(keymap.of(bindings))
}

export function createExtensions(opts: EditorOptions): Extension[] {
  const { settings } = opts

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
      override: [wikilinkCompletion, tagCompletion, slashCompletion],
      activateOnTyping: true,
      icons: false,
      closeOnBlur: true,
      maxRenderedOptions: 50
    }),

    settingsCompartment.of(settingsExtensions(opts.path, settings)),
    formatKeymapCompartment.of(buildFormatKeymap(opts.onSave)),
    linkClickHandlers(opts.handlers),
    editorContextMenu(),
    attachmentDropExtension(),
    linkPasteExtension(),
    luminaEditorTheme,

    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap]),
    keymap.of(standardKeymap),
    keymap.of(defaultKeymap),

    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.state.doc.toString())
    }),

    // With split view, more than one editor can be mounted at once — commands
    // dispatch to whichever one last had focus, not just whichever mounted
    // most recently (see `activeView.ts`).
    EditorView.domEventHandlers({
      focus: (_event, view) => setActiveView(view)
    })
  ]
}
