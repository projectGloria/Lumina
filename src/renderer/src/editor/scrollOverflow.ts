/**
 * Toggles `.cm-has-overflow` on the scroller so `markdown.css` can hide the
 * scrollbar entirely when a note's real content fits on screen.
 *
 * `.cm-scroller` carries a large bottom padding (see `markdown.css`) so the
 * last line never sits glued to the floor — but that padding alone always
 * makes `scrollHeight` exceed `clientHeight`, which would otherwise mark
 * every note "scrollable" even a one-line one. This subtracts that reserved
 * padding back out before deciding whether there is anything to scroll.
 */
import { ViewPlugin, type EditorView, type PluginValue } from '@codemirror/view'

function syncOverflow(view: EditorView): void {
  const scroller = view.scrollDOM
  const reserve = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
  const overflowing = scroller.scrollHeight - reserve > scroller.clientHeight + 1
  scroller.classList.toggle('cm-has-overflow', overflowing)
}

class ScrollOverflowPlugin implements PluginValue {
  private observer: ResizeObserver

  constructor(view: EditorView) {
    this.observer = new ResizeObserver(() => syncOverflow(view))
    this.observer.observe(view.scrollDOM)
    this.observer.observe(view.contentDOM)
    syncOverflow(view)
  }

  update(update: { docChanged: boolean; geometryChanged: boolean; view: EditorView }): void {
    if (update.docChanged || update.geometryChanged) syncOverflow(update.view)
  }

  destroy(): void {
    this.observer.disconnect()
  }
}

export const scrollOverflowExtension = ViewPlugin.fromClass(ScrollOverflowPlugin)
