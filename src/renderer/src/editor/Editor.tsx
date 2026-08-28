import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { consumeReveal, createFromLink, openNote } from '../lib/actions'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { useUi } from '../store/uiStore'
import { aliasMap, knownPaths, useVault } from '../store/vaultStore'
import { parseFrontmatter, resolveLink } from '@shared/markdown-parse'
import { setActiveView } from './activeView'
import { createExtensions, settingsCompartment, settingsExtensions } from './extensions'
import { revealLine } from './format'
import { refreshPreview } from './livePreview'

/**
 * Offset of the first line after any frontmatter.
 *
 * Opening a note puts the caret here rather than at position zero, so it lands
 * in the body instead of inside the frontmatter — which would both be an odd
 * place to start typing and force the properties strip back to raw source.
 * It deliberately stops on the blank line that usually follows the closing
 * fence, so the first heading renders cleanly instead of showing its `#`.
 */
function bodyStart(content: string): number {
  const { lines } = parseFrontmatter(content)
  if (!lines) return 0

  let seen = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n' && ++seen === lines) return i + 1
  }
  return 0
}

export default function Editor({ path }: { path: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  const buffer = useEditor((s) => s.buffers[path])
  const setContent = useEditor((s) => s.setContent)
  const save = useEditor((s) => s.save)
  const editorSettings = useSettings((s) => s.settings.editor)
  const index = useVault((s) => s.index)

  // Load the note the first time this path appears.
  useEffect(() => {
    void useEditor.getState().open(path)
  }, [path])

  const ready = !!buffer && !buffer.loading

  /* ---------------------------------------------------- create the view */
  useEffect(() => {
    if (!host.current || !ready) return

    const state = EditorState.create({
      doc: buffer.content,
      selection: { anchor: bodyStart(buffer.content) },
      extensions: createExtensions({
        path,
        settings: useSettings.getState().settings.editor,
        onChange: (content) => setContent(path, content),
        onSave: () => void save(path),
        handlers: {
          openNote: (target, opts) => {
            const resolved = resolveLink(target, path, knownPaths(), aliasMap())
            if (resolved) openNote(resolved, { newTab: opts.newTab, anchor: opts.anchor })
            else void createFromLink(target, path)
          },
          openTag: (tag) => {
            useUi.getState().setTagFilter(tag)
            useUi.getState().setSearchQuery(`#${tag}`)
          },
          openUrl: (url) => void window.lumina.files.openExternal(url)
        }
      })
    })

    const instance = new EditorView({ state, parent: host.current })
    view.current = instance
    setActiveView(instance)

    // Jump to the heading or line the navigation asked for.
    const reveal = consumeReveal(path)
    if (reveal) {
      const line =
        reveal.line ??
        useVault
          .getState()
          .index.notes[path]?.headings.find(
            (h) => h.text.toLowerCase() === reveal.anchor?.toLowerCase()
          )?.line
      if (line !== undefined) revealLine(instance, line)
    } else {
      instance.focus()
    }

    return () => {
      // Flush anything typed in the last few hundred milliseconds.
      void useEditor.getState().save(path)
      if (view.current === instance) {
        view.current = null
        setActiveView(null)
      }
      instance.destroy()
    }
    // Recreating on `ready` covers the first load; content updates are handled
    // by the sync effect below rather than by rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ready])

  /* ------------------------------------------- external content changes */
  useEffect(() => {
    const instance = view.current
    if (!instance || !buffer || buffer.loading) return
    const current = instance.state.doc.toString()
    if (current === buffer.content) return
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: buffer.content },
      // Keep the caret in range rather than resetting it to the top.
      selection: { anchor: Math.min(instance.state.selection.main.anchor, buffer.content.length) }
    })
  }, [buffer?.content, buffer?.loading, buffer])

  /* ---------------------------------------------------- settings changes */
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    instance.dispatch({
      effects: settingsCompartment.reconfigure(settingsExtensions(path, editorSettings))
    })
  }, [editorSettings, path])

  /* -------------------------------- re-resolve links when the index moves */
  useEffect(() => {
    view.current?.dispatch({ effects: refreshPreview.of(null) })
  }, [index])

  if (buffer?.error) {
    return (
      <div className="empty-state">
        <h2>Could not open this note</h2>
        <p>{buffer.error}</p>
      </div>
    )
  }

  return <div className="editor-host" ref={host} />
}
