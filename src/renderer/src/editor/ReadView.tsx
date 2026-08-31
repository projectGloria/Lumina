import { useMemo } from 'react'
import { renderNoteFragment } from '../lib/render'
import { useEditor } from '../store/editorStore'

/** A rendered, non-editable view of a note — swapped in for the CodeMirror editor in read mode. */
export default function ReadView({ path }: { path: string }): React.JSX.Element {
  const content = useEditor((s) => s.buffers[path]?.content)

  const html = useMemo(() => (content === undefined ? '' : renderNoteFragment(content, path)), [content, path])

  return (
    <div className="note-view">
      <div className="note-view-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
