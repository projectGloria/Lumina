/** Pasting or dragging an image file into the editor saves it to the vault and inserts a link. */
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { useSettings } from '../store/settingsStore'
import { toast } from '../store/uiStore'

function imageFilesFrom(list: DataTransfer | null): File[] {
  if (!list) return []
  return [...list.files].filter((f) => f.type.startsWith('image/'))
}

async function insertAttachment(view: EditorView, file: File, at: number): Promise<void> {
  const folder = useSettings.getState().settings.attachmentFolder
  const buffer = await file.arrayBuffer()
  const res = await window.lumina.files.saveAttachment(folder, file.name, buffer)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not save the image', 'error')
    return
  }
  const insert = `![${file.name.replace(/\.[^.]+$/, '')}](${res.data})\n`
  view.dispatch({
    changes: { from: at, to: at, insert },
    selection: { anchor: at + insert.length }
  })
}

export function attachmentDropExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = imageFilesFrom(event.clipboardData)
      if (!files.length) return false
      event.preventDefault()
      const at = view.state.selection.main.from
      void insertAttachment(view, files[0], at)
      return true
    },
    drop(event, view) {
      const files = imageFilesFrom(event.dataTransfer)
      if (!files.length) return false
      event.preventDefault()
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from
      void insertAttachment(view, files[0], at)
      return true
    }
  })
}
