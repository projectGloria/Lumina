/** A right-click menu for the editor, using the same `showContextMenu` mechanism as the file tree. */
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { insertLink, toggleWrap } from './format'
import { toast, useUi } from '../store/uiStore'

export function editorContextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const sel = view.state.selection.main
      const hasSelection = !sel.empty
      const selectedText = hasSelection ? view.state.sliceDoc(sel.from, sel.to) : ''

      event.preventDefault()
      useUi.getState().showContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: 'Bold',
            onSelect: () => {
              view.focus()
              toggleWrap(view, '**')
            }
          },
          {
            label: 'Italic',
            onSelect: () => {
              view.focus()
              toggleWrap(view, '*')
            }
          },
          {
            label: 'Link',
            onSelect: () => {
              view.focus()
              insertLink(view)
            }
          },
          { separator: true, label: 'sep1' },
          {
            label: 'Cut',
            onSelect: () => {
              if (!hasSelection) return
              void navigator.clipboard.writeText(selectedText)
              view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } })
              view.focus()
            }
          },
          {
            label: 'Copy',
            onSelect: () => {
              if (hasSelection) void navigator.clipboard.writeText(selectedText)
            }
          },
          {
            label: 'Paste',
            onSelect: () => {
              void navigator.clipboard.readText().then((text) => {
                if (!text) return
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: text },
                  selection: { anchor: sel.from + text.length }
                })
                view.focus()
              })
            }
          },
          { separator: true, label: 'sep2' },
          {
            label: 'Copy as wikilink',
            onSelect: () => {
              if (!hasSelection) return
              void navigator.clipboard.writeText(`[[${selectedText}]]`)
              toast('Copied as wikilink')
            }
          }
        ]
      })
      return true
    }
  })
}
