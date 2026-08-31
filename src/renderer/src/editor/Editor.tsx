import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createFromLink, openNote } from '../lib/actions'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { useUi, type RevealRequest } from '../store/uiStore'
import { aliasMap, knownPaths, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'
import { parseFrontmatter, resolveLink } from '@shared/markdown-parse'
import { getActiveView, setActiveView } from './activeView'
import { buildFormatKeymap, createExtensions, formatKeymapCompartment, settingsCompartment, settingsExtensions } from './extensions'
import { revealLine } from './format'
import { refreshPreview } from './livePreview'
import { rememberSession, restoreSessionScroll, sessionState } from './session'

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

/**
 * Where the caret goes when a note is opened without a parked session.
 *
 * A tab restored from `workspace.json` carries the offset it was left at, which
 * can be out of range if the file changed while Lumina was closed — so it is
 * clamped rather than trusted.
 */
function startAnchor(path: string, content: string): number {
  const stored = useWorkspace.getState().tabs.find((tab) => tab.path === path)?.cursor
  if (stored === undefined) return bodyStart(content)
  return Math.max(0, Math.min(stored, content.length))
}

/**
 * Scroll to the line or heading a reveal request names, if it is for this note.
 *
 * Returns true when it did something, so the caller can decide whether to fall
 * back to plain focus. Clearing by nonce means a request for a different note
 * survives until that note's own editor picks it up.
 */
function applyReveal(view: EditorView, path: string, reveal: RevealRequest | null): boolean {
  if (!reveal || reveal.path !== path) return false

  const line =
    reveal.line ??
    useVault
      .getState()
      .index.notes[path]?.headings.find(
        (h) => h.text.toLowerCase() === reveal.anchor?.toLowerCase()
      )?.line

  useUi.getState().clearReveal(reveal.nonce)
  if (line === undefined) return false
  revealLine(view, line)
  return true
}

export default function Editor({ path }: { path: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  const buffer = useEditor((s) => s.buffers[path])
  const setContent = useEditor((s) => s.setContent)
  const save = useEditor((s) => s.save)
  const editorSettings = useSettings((s) => s.settings.editor)
  const hotkeys = useSettings((s) => s.settings.hotkeys)
  const index = useVault((s) => s.index)
  const reveal = useUi((s) => s.reveal)

  // Load the note the first time this path appears.
  useEffect(() => {
    void useEditor.getState().open(path)
  }, [path])

  const ready = !!buffer && !buffer.loading

  /* --------------------------------------------------- the view's lifetime */
  // One view for the whole workspace, kept across tab switches. Only leaving
  // the editor area entirely — closing the last tab, changing vaults — tears
  // it down.
  useEffect(() => {
    return () => {
      const instance = view.current
      if (!instance) return
      view.current = null
      // Only clear the shared singleton if this was the pane it pointed at —
      // with split view open, the other pane's editor may already be active.
      if (getActiveView() === instance) setActiveView(null)
      instance.destroy()
    }
  }, [])

  /* -------------------------------------------------- swap in a note */
  useEffect(() => {
    if (!host.current) return

    // The view outlives the tab now, so a note whose buffer has not arrived
    // must not be left showing the previous note's text under the new tab's
    // name — and nothing should be able to edit it in the meantime.
    if (!ready) {
      view.current?.setState(EditorState.create({ doc: '' }))
      setActiveView(null)
      return
    }

    const freshState = (): EditorState =>
      EditorState.create({
        doc: buffer.content,
        // Reopening a note lands where it was last read; a note being seen for
        // the first time starts below any frontmatter.
        selection: { anchor: startAnchor(path, buffer.content) },
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

    // A parked session restores the caret, selection and undo history intact;
    // without one the note is being opened for the first time this session.
    const parked = sessionState(path, buffer.content)
    const state = parked ?? freshState()

    let instance = view.current
    if (instance) {
      instance.setState(state)
    } else {
      instance = new EditorView({ state, parent: host.current })
      view.current = instance
    }
    setActiveView(instance)
    if (parked) restoreSessionScroll(path, instance)

    // Jump to the heading or line the navigation asked for. A request aimed at
    // a note that was already open is handled by the effect below instead.
    if (!applyReveal(instance, path, useUi.getState().reveal)) instance.focus()

    return () => {
      // Flush anything typed in the last few hundred milliseconds, and park the
      // session so coming back to this tab resumes rather than restarts. Only
      // reachable from the ready branch, so the empty placeholder above can
      // never be parked over a good session.
      void useEditor.getState().save(path)
      if (view.current) rememberSession(path, view.current)
    }
    // Content updates are handled by the sync effect below rather than by
    // rebuilding the state, which would discard the history again.
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

  /* ------------------------------------------------------ hotkey rebinds */
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    instance.dispatch({
      effects: formatKeymapCompartment.reconfigure(buildFormatKeymap(() => void save(path)))
    })
  }, [hotkeys, path, save])

  /* -------------------------------- re-resolve links when the index moves */
  useEffect(() => {
    view.current?.dispatch({ effects: refreshPreview.of(null) })
  }, [index])

  /* --------------------------------------------- scroll to a search result */
  // The note may already be the active tab, in which case nothing remounts and
  // the reveal has to be applied to the view that is already on screen.
  useEffect(() => {
    if (view.current) applyReveal(view.current, path, reveal)
  }, [reveal, path, ready])

  if (buffer?.error) {
    return (
      <div className="empty-state">
        <h2>Could not open this note</h2>
        <p>{buffer.error}</p>
        <button className="btn btn-primary" onClick={() => void useEditor.getState().open(path)}>
          Try again
        </button>
      </div>
    )
  }

  return <div className="editor-host" ref={host} />
}
