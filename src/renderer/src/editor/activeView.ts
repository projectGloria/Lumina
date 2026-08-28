import type { EditorView } from '@codemirror/view'

/**
 * The CodeMirror view for the note on screen.
 *
 * Commands and the status bar need to reach the editor from outside React, and
 * only one note is focused at a time, so a module-level reference is simpler
 * and more reliable than threading a ref through the tree.
 */
let view: EditorView | null = null

export function setActiveView(next: EditorView | null): void {
  view = next
}

export function getActiveView(): EditorView | null {
  return view
}
