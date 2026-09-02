import type { TabState } from './types'

export interface OpenTabOptions {
  /** Allow another tab for a path that is already open. */
  newTab?: boolean
  /** Replace the active tab, used by navigation history. */
  replace?: boolean
}

export interface TabTransition {
  tabs: TabState[]
  activeTab: number
}

/**
 * Decide how opening a path changes the tab strip.
 *
 * Ordinary opens append a tab, an already-open path is activated, and only
 * explicit history-style navigation replaces the active tab.
 */
export function openTab(
  tabs: TabState[],
  activeTab: number,
  path: string,
  options: OpenTabOptions = {}
): TabTransition {
  const existing = tabs.findIndex((tab) => tab.path === path)
  if (existing !== -1 && !options.newTab) return { tabs, activeTab: existing }

  const tab: TabState = { path, mode: tabs[activeTab]?.mode }
  if (options.replace && tabs.length) {
    const next = tabs.slice()
    next[activeTab] = tab
    return { tabs: next, activeTab }
  }

  return { tabs: [...tabs, tab], activeTab: tabs.length }
}
