import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { useUi } from '../store/uiStore'

const BARE_URL = /^https?:\/\/\S+$/i

export function linkPasteExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain')?.trim()
      if (!text || !BARE_URL.test(text)) return false

      const { state } = view
      const sel = state.selection.main
      // Pasting over a selection (e.g. to link some existing text) should
      // keep the plain-URL behaviour so the selected text becomes the label.
      if (!sel.empty) {
        view.dispatch(
          state.update({
            changes: { from: sel.from, to: sel.to, insert: `[${state.sliceDoc(sel.from, sel.to)}](${text})` },
            selection: { anchor: sel.from + text.length + 4 + (sel.to - sel.from) }
          })
        )
        event.preventDefault()
        return true
      }

      let label = text
      try {
        label = new URL(text).hostname.replace(/^www\./, '')
      } catch {
        // Keep the raw URL as the label.
      }

      event.preventDefault()

      const coords = view.coordsAtPos(sel.from)
      const x = coords ? coords.left : Math.max(16, window.innerWidth / 2 - 100)
      const y = coords ? coords.bottom + 4 : Math.max(16, window.innerHeight / 2 - 50)

      useUi.getState().showContextMenu({
        x,
        y,
        items: [
          {
            label: '🔗 Plain link',
            onSelect: () => {
              const insert = `[${label}](${text})`
              view.dispatch(
                view.state.update({
                  changes: { from: sel.from, to: sel.to, insert },
                  selection: { anchor: sel.from + insert.length }
                })
              )
              view.focus()
            }
          },
          {
            label: '🪪 Banner card',
            onSelect: () => {
              const insert = `[banner](${text})`
              view.dispatch(
                view.state.update({
                  changes: { from: sel.from, to: sel.to, insert },
                  selection: { anchor: sel.from + insert.length }
                })
              )
              view.focus()
            }
          }
        ]
      })

      return true
    }
  })
}
