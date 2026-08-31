/**
 * One editor session per open note, so switching tabs is not destructive.
 *
 * A tab switch used to rebuild the CodeMirror view from the buffer text, which
 * threw away undo history, the selection and the scroll position every time.
 * Keeping the `EditorState` means the whole editing session survives: the state
 * carries the history field, the selection, and the extension set built for
 * that note. Scroll lives on the DOM rather than in the state, so it is
 * snapshotted alongside.
 */
import type { EditorState, StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useEditor } from '../store/editorStore'
import { useWorkspace } from '../store/workspaceStore'

interface Session {
  state: EditorState
  /** A `scrollIntoView` effect that puts the viewport back where it was. */
  scroll: StateEffect<unknown>
}

const sessions = new Map<string, Session>()

/**
 * Store the session for a note being left, and record its caret in the tab.
 *
 * The caret goes to `workspaceStore` rather than staying here because it is the
 * one part of a session worth surviving a restart — `TabState.cursor` is what
 * reopens a note where it was last read.
 */
export function rememberSession(path: string, view: EditorView): void {
  // A tab closed while this note was on screen releases the buffer, and React
  // may run the editor's cleanup after that. Parking a session for a note
  // nothing holds any more would survive until the next buffer change.
  if (!(path in useEditor.getState().buffers)) return
  sessions.set(path, { state: view.state, scroll: view.scrollSnapshot() })
  useWorkspace.getState().setTabCursor(path, view.state.selection.main.head)
}

/**
 * The stored state for a note, or null when there is nothing usable.
 *
 * A session is only good while it still describes the buffer. A note edited on
 * disk while its tab sat in the background is reloaded into the buffer without
 * the parked state hearing about it, so a stale session is dropped rather than
 * shown and then patched — which would leave the reload sitting in the undo
 * history as one enormous edit.
 */
export function sessionState(path: string, content: string): EditorState | null {
  const session = sessions.get(path)
  if (!session) return null
  if (session.state.doc.toString() !== content) {
    sessions.delete(path)
    return null
  }
  return session.state
}

/** Put the viewport back. Call after the state is in the view, never before. */
export function restoreSessionScroll(path: string, view: EditorView): void {
  const session = sessions.get(path)
  if (session) view.dispatch({ effects: session.scroll as StateEffect<unknown> })
}

/** Capture the note on screen, for a quit or a vault switch. */
export function captureActiveSession(path: string | null, view: EditorView | null): void {
  if (path && view) rememberSession(path, view)
}

// Sessions live exactly as long as their buffers. Closing a tab, deleting a
// note and switching vaults all drop buffers, so watching that one place keeps
// this cache bounded without every caller having to remember it exists.
useEditor.subscribe((state, previous) => {
  if (state.buffers === previous.buffers) return
  for (const path of [...sessions.keys()]) {
    if (!(path in state.buffers)) sessions.delete(path)
  }
})
