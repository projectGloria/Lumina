import { create } from 'zustand'
import type { LeftPanel, RightPanel, TabState, WorkspaceState } from '@shared/types'

interface WorkspaceStore extends WorkspaceState {
  /** Navigation history across all tabs, for Alt+Left / Alt+Right. */
  history: string[]
  historyIndex: number
  hydrated: boolean

  hydrate: (state: WorkspaceState) => void
  openNote: (path: string, opts?: { newTab?: boolean; replace?: boolean }) => void
  closeTab: (index: number) => void
  closeOthers: (index: number) => void
  activateTab: (index: number) => void
  moveTab: (from: number, to: number) => void
  nextTab: (delta: number) => void
  renamePathInTabs: (from: string, to: string) => void
  removePathFromTabs: (path: string) => void
  back: () => void
  forward: () => void

  setLeftPanel: (panel: LeftPanel) => void
  setRightPanel: (panel: RightPanel) => void
  toggleLeft: () => void
  toggleRight: () => void
  setLeftWidth: (w: number) => void
  setRightWidth: (w: number) => void
  toggleExpanded: (path: string) => void
  setExpanded: (paths: string[]) => void
  toggleFocusMode: () => void
}

const INITIAL: WorkspaceState = {
  tabs: [],
  activeTab: 0,
  leftOpen: true,
  rightOpen: true,
  leftWidth: 260,
  rightWidth: 300,
  leftPanel: 'files',
  rightPanel: 'backlinks',
  expanded: [],
  focusMode: false
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** Save the layout back to `.lumina/workspace.json`, coalesced. */
function persist(state: WorkspaceStore): void {
  if (!state.hydrated) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void window.lumina.workspace.set({
      tabs: state.tabs,
      activeTab: state.activeTab,
      leftOpen: state.leftOpen,
      rightOpen: state.rightOpen,
      leftWidth: state.leftWidth,
      rightWidth: state.rightWidth,
      leftPanel: state.leftPanel,
      rightPanel: state.rightPanel,
      expanded: state.expanded,
      focusMode: state.focusMode
    })
  }, 500)
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  /** Apply a patch and schedule a save. */
  const update = (patch: Partial<WorkspaceStore>): void => {
    set(patch)
    persist(get())
  }

  const pushHistory = (path: string): void => {
    const { history, historyIndex } = get()
    if (history[historyIndex] === path) return
    const trimmed = history.slice(0, historyIndex + 1)
    trimmed.push(path)
    set({ history: trimmed.slice(-100), historyIndex: Math.min(trimmed.length - 1, 99) })
  }

  return {
    ...INITIAL,
    history: [],
    historyIndex: -1,
    hydrated: false,

    hydrate: (state) => {
      set({ ...state, hydrated: true })
      const active = state.tabs[state.activeTab]
      if (active) set({ history: [active.path], historyIndex: 0 })
    },

    openNote: (path, opts = {}) => {
      const { tabs, activeTab } = get()
      const existing = tabs.findIndex((t) => t.path === path)

      if (existing !== -1 && !opts.newTab) {
        update({ activeTab: existing })
        pushHistory(path)
        return
      }

      const tab: TabState = { path }
      if (opts.replace && tabs.length) {
        const next = tabs.slice()
        next[activeTab] = tab
        update({ tabs: next })
      } else if (opts.newTab || !tabs.length) {
        update({ tabs: [...tabs, tab], activeTab: tabs.length })
      } else {
        const next = tabs.slice()
        next[activeTab] = tab
        update({ tabs: next })
      }
      pushHistory(path)
    },

    closeTab: (index) => {
      const { tabs, activeTab } = get()
      const next = tabs.filter((_, i) => i !== index)
      const active = index < activeTab || activeTab >= next.length ? Math.max(0, activeTab - 1) : activeTab
      update({ tabs: next, activeTab: Math.min(active, Math.max(0, next.length - 1)) })
    },

    closeOthers: (index) => {
      const { tabs } = get()
      if (!tabs[index]) return
      update({ tabs: [tabs[index]], activeTab: 0 })
    },

    activateTab: (index) => {
      const { tabs } = get()
      if (!tabs[index]) return
      update({ activeTab: index })
      pushHistory(tabs[index].path)
    },

    moveTab: (from, to) => {
      const tabs = get().tabs.slice()
      const [moved] = tabs.splice(from, 1)
      if (!moved) return
      tabs.splice(to, 0, moved)
      const activePath = get().tabs[get().activeTab]?.path
      update({ tabs, activeTab: Math.max(0, tabs.findIndex((t) => t.path === activePath)) })
    },

    nextTab: (delta) => {
      const { tabs, activeTab } = get()
      if (tabs.length < 2) return
      const index = (activeTab + delta + tabs.length) % tabs.length
      get().activateTab(index)
    },

    renamePathInTabs: (from, to) => {
      const tabs = get().tabs.map((t) => (t.path === from ? { ...t, path: to } : t))
      update({ tabs })
      set({ history: get().history.map((h) => (h === from ? to : h)) })
    },

    removePathFromTabs: (path) => {
      const { tabs, activeTab } = get()
      if (!tabs.some((t) => t.path === path)) return
      const next = tabs.filter((t) => t.path !== path)
      update({ tabs: next, activeTab: Math.min(activeTab, Math.max(0, next.length - 1)) })
    },

    back: () => {
      const { history, historyIndex } = get()
      if (historyIndex <= 0) return
      const index = historyIndex - 1
      set({ historyIndex: index })
      get().openNote(history[index], { replace: true })
      set({ historyIndex: index })
    },

    forward: () => {
      const { history, historyIndex } = get()
      if (historyIndex >= history.length - 1) return
      const index = historyIndex + 1
      set({ historyIndex: index })
      get().openNote(history[index], { replace: true })
      set({ historyIndex: index })
    },

    setLeftPanel: (panel) => update({ leftPanel: panel, leftOpen: true }),
    setRightPanel: (panel) => update({ rightPanel: panel, rightOpen: true }),
    toggleLeft: () => update({ leftOpen: !get().leftOpen }),
    toggleRight: () => update({ rightOpen: !get().rightOpen }),
    setLeftWidth: (w) => update({ leftWidth: Math.max(180, Math.min(520, w)) }),
    setRightWidth: (w) => update({ rightWidth: Math.max(200, Math.min(560, w)) }),

    toggleExpanded: (path) => {
      const expanded = get().expanded
      update({
        expanded: expanded.includes(path)
          ? expanded.filter((p) => p !== path)
          : [...expanded, path]
      })
    },
    setExpanded: (paths) => update({ expanded: paths }),

    toggleFocusMode: () => update({ focusMode: !get().focusMode })
  }
})

/** Path of the note currently in view, or null. */
export function activePath(): string | null {
  const { tabs, activeTab } = useWorkspace.getState()
  return tabs[activeTab]?.path ?? null
}
