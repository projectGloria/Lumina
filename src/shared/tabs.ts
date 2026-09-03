import type { TabKind, TabState } from './types'
import { isNoteTab } from './types'

export interface OpenTabOptions {
  /** Allow another tab for a path that is already open. */
  newTab?: boolean
  /** Replace the active tab, used by navigation history. */
  replace?: boolean
  /** What the new tab shows. Absent means a note. */
  kind?: TabKind
}

export interface TabTransition {
  tabs: TabState[]
  activeTab: number
}

/**
 * Decide how opening a path changes the tab strip.
 *
 * Ordinary opens append a tab, an already-open path is activated, and only
 * explicit history-style navigation replaces the active tab. Every caller goes
 * through here, so a component cannot invent a second rule.
 */
export function openTab(
  tabs: TabState[],
  activeTab: number,
  path: string,
  options: OpenTabOptions = {}
): TabTransition {
  const current = tabs[activeTab]

  // Home names no file, so it is identified by kind rather than by path and
  // there is only ever one of it: the board holds no per-tab state worth
  // duplicating, and a strip of identical boards is only ever a mistake.
  if (options.kind === 'home') {
    const open = tabs.findIndex((tab) => tab.kind === 'home')
    if (open !== -1) return { tabs, activeTab: open }
    return { tabs: [...tabs, { kind: 'home', path: '' }], activeTab: tabs.length }
  }

  const existing = tabs.findIndex((tab) => isNoteTab(tab) && tab.path === path)
  if (existing !== -1 && !options.newTab) return { tabs, activeTab: existing }

  const tab: TabState = { path, mode: current && isNoteTab(current) ? current.mode : undefined }
  // Replacing Home would close the board rather than navigate within it, so
  // history navigation from Home opens a tab instead.
  if (options.replace && tabs.length && current && isNoteTab(current)) {
    const next = tabs.slice()
    next[activeTab] = tab
    return { tabs: next, activeTab }
  }

  return { tabs: [...tabs, tab], activeTab: tabs.length }
}

/** Show the Home board, reusing the tab it is already open in. */
export function openHomeTab(tabs: TabState[], activeTab: number): TabTransition {
  return openTab(tabs, activeTab, '', { kind: 'home' })
}
