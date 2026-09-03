/** Pasting or dragging an image file into the editor saves it to the vault and inserts a link. */
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { encodeTarget } from '@shared/markdown-parse'
import { useSettings } from '../store/settingsStore'
import { toast } from '../store/uiStore'

/**
 * Every image on a clipboard or a drag, in order.
 *
 * `DataTransfer.files` is empty for some sources that still carry an image (a
 * copy out of another Electron app, for one), so the item list is consulted as
 * well and duplicates are dropped by name and size.
 */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<string>()
  const add = (file: File | null): void => {
    if (!file || !file.type.startsWith('image/')) return
    const key = `${file.name}:${file.size}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }
  for (const file of data.files) add(file)
  for (const item of data.items) if (item.kind === 'file') add(item.getAsFile())
  return out
}

/**
 * A screenshot arrives as `image.png` every time, so the second one saved in a
 * session becomes `image 1.png` and the third `image 2.png`. Naming it for the
 * moment it was pasted keeps them apart, keeps them sortable, and reads better
 * in the attachments folder than a run of numbered `image`s.
 */
const GENERIC_NAME = /^(?:image|clipboard|untitled|screenshot)?\s*\.(\w+)$/i

function attachmentName(file: File): string {
  const name = file.name || 'image.png'
  const generic = name.match(GENERIC_NAME)
  if (!generic) return name
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `Pasted image ${stamp}.${generic[1]}`
}

async function insertAttachments(view: EditorView, files: File[], from: number, to: number): Promise<void> {
  const folder = useSettings.getState().settings.attachmentFolder
  const embeds: string[] = []

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const res = await window.lumina.files.saveAttachment(folder, attachmentName(file), buffer)
    if (!res.ok || !res.data) {
      toast(res.error ?? `Could not save ${file.name}`, 'error')
      continue
    }
    // The saved name can hold spaces — from the file itself or from the ` 1`
    // that `uniquePath` adds on a collision — and an unencoded space ends a
    // markdown destination early, so the line would not parse as an image.
    embeds.push(`![${res.data.replace(/^.*\//, '').replace(/\.[^.]+$/, '')}](${encodeTarget(res.data)})`)
  }
  if (!embeds.length) return

  const insert = `${embeds.join('\n')}\n`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true
  })
}

export function attachmentDropExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = imageFilesFrom(event.clipboardData)
      if (!files.length) return false
      event.preventDefault()
      // Replace the selection the way a normal paste would, rather than
      // inserting at its start and leaving the old text behind.
      const sel = view.state.selection.main
      void insertAttachments(view, files, sel.from, sel.to)
      return true
    },
    drop(event, view) {
      const files = imageFilesFrom(event.dataTransfer)
      if (!files.length) return false
      event.preventDefault()
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from
      void insertAttachments(view, files, at, at)
      return true
    }
  })
}
