/**
 * The Home board's layout.
 *
 * Per-vault layout state, so it lives in `<vault>/.lumina/home.json` next to
 * `workspace.json` rather than in `Settings` — and it follows that file's
 * pattern exactly: debounced writes, one queued chain, and a flush that the
 * quit handler awaits so a layout tweak made a moment before closing survives.
 */
import { create } from 'zustand'
import type { HomeCover, HomeLayout, HomeWidget } from '@shared/types'
import { HOME_LAYOUT_VERSION } from '@shared/types'
import { compact, normalizeLayout, withWidgets } from '@shared/homeLayout'

/** The column count layouts are authored against; the board rescales below it. */
export const HOME_COLUMNS = 4

const emptyLayout = (): HomeLayout => ({
  version: HOME_LAYOUT_VERSION,
  columns: HOME_COLUMNS,
  widgets: []
})

interface HomeStore {
  layout: HomeLayout
  /** True once a vault's board has been read, so a save cannot beat the load. */
  hydrated: boolean
  /**
   * Edit-layout mode. Session-only: nothing about the board should be movable
   * on the launch after the one where it was arranged.
   */
  editing: boolean

  /**
   * Read this vault's board, seeding a starter one when it has never had a
   * board at all. The seed is passed in rather than imported so the store
   * stays independent of the widget registry.
   */
  load: (seed?: () => HomeLayout) => Promise<void>
  reset: () => void
  setEditing: (editing: boolean) => void
  /**
   * Replace the board with an arrangement made at `columns` columns.
   *
   * The stored `columns` is re-authored on every commit, so the coordinates
   * and the width they were arranged at always agree — rearranging on a narrow
   * window is honest about having done so rather than silently writing
   * two-column coordinates into a four-column file.
   */
  commit: (widgets: HomeWidget[], columns: number) => void
  removeWidget: (id: string) => void
  /** Set or clear the picture across the top of the board. */
  setCover: (cover: HomeCover | null) => void
  setWidgetConfig: (id: string, patch: Record<string, unknown>) => void
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingLayout: HomeLayout | null = null
let persistChain: Promise<void> = Promise.resolve()

/** Save the board back to `.lumina/home.json`, coalesced. */
function persist(state: HomeStore): void {
  if (!state.hydrated) return
  pendingLayout = state.layout
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushHomePersistence().catch(() => {})
  }, 500)
}

/** Write the latest debounced layout out before a vault switch or a quit. */
export async function flushHomePersistence(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const pending = pendingLayout
  pendingLayout = null
  if (pending) {
    persistChain = persistChain
      .catch(() => {})
      .then(() => window.lumina.home.set(pending).then(() => {}))
  }
  await persistChain
}

export const useHome = create<HomeStore>((set, get) => {
  const update = (layout: HomeLayout): void => {
    set({ layout })
    persist(get())
  }

  return {
    layout: emptyLayout(),
    hydrated: false,
    editing: false,

    /**
     * Read this vault's board.
     *
     * A vault that has never had one comes back null, which is the cue to seed
     * a starter board rather than open on an empty page. An emptied board is a
     * file with no widgets in it, and stays empty.
     */
    load: async (seed) => {
      let stored: HomeLayout | null = null
      try {
        stored = await window.lumina.home.get()
      } catch {
        // A board that cannot be read is a board the user rearranges again,
        // not a reason to fail opening the vault.
      }

      if (stored) {
        // `home.json` is a plain file a user may have edited, so nothing about
        // it is trusted: coordinates are clamped and overlaps resolved here.
        set({ layout: normalizeLayout(stored), hydrated: true, editing: false })
        return
      }

      set({ layout: seed ? seed() : emptyLayout(), hydrated: true, editing: false })
      // Written out at once so the starter board's widget ids are the ones it
      // keeps — regenerating them every launch would lose per-widget options.
      if (seed) persist(get())
    },

    /** Drop the board on the way out of a vault; layouts are not shared. */
    reset: () => {
      pendingLayout = null
      set({ layout: emptyLayout(), hydrated: false, editing: false })
    },

    setEditing: (editing) => set({ editing }),

    // Through `withWidgets` rather than a fresh object, so the cover survives
    // an arrangement — rebuilding the layout here is what used to delete it.
    commit: (widgets, columns) => update(withWidgets(get().layout, widgets, columns)),

    removeWidget: (id) => {
      const { columns, widgets } = get().layout
      // Compacted at the authored width, not at whatever is on screen: a
      // removal should not re-author a board arranged on a wider window.
      update({
        ...get().layout,
        widgets: compact(
          widgets.filter((widget) => widget.id !== id),
          columns
        )
      })
    },

    setCover: (cover) => {
      const { cover: _dropped, ...rest } = get().layout
      update(cover ? { ...rest, cover } : rest)
    },

    setWidgetConfig: (id, patch) =>
      update({
        ...get().layout,
        widgets: get().layout.widgets.map((widget) =>
          widget.id === id ? { ...widget, config: { ...widget.config, ...patch } } : widget
        )
      })
  }
})
