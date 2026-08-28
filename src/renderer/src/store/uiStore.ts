import { create } from 'zustand'

export type ModalKind = 'palette' | 'switcher' | 'settings' | 'graph' | null

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

export interface MenuItem {
  label: string
  danger?: boolean
  separator?: boolean
  onSelect?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: MenuItem[]
}

export interface PromptState {
  title: string
  label?: string
  initial: string
  confirmLabel?: string
  /** Return an error string to keep the dialog open. */
  onSubmit: (value: string) => string | void | Promise<string | void>
  /** Select this many characters from the start, for renaming without the extension. */
  selectLength?: number
}

export interface ConfirmState {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
}

interface UiState {
  modal: ModalKind
  settingsTab: string
  contextMenu: ContextMenuState | null
  prompt: PromptState | null
  confirm: ConfirmState | null
  toasts: Toast[]
  /** Tag currently filtering the file list, or null. */
  tagFilter: string | null
  /** Search query shared between the search panel and its results. */
  searchQuery: string

  openModal: (kind: ModalKind) => void
  closeModal: () => void
  openSettings: (tab?: string) => void
  showContextMenu: (menu: ContextMenuState) => void
  hideContextMenu: () => void
  showPrompt: (prompt: PromptState) => void
  hidePrompt: () => void
  showConfirm: (confirm: ConfirmState) => void
  hideConfirm: () => void
  pushToast: (message: string, kind?: 'info' | 'error') => void
  dismissToast: (id: number) => void
  setTagFilter: (tag: string | null) => void
  setSearchQuery: (q: string) => void
}

let toastId = 0

export const useUi = create<UiState>((set, get) => ({
  modal: null,
  settingsTab: 'appearance',
  contextMenu: null,
  prompt: null,
  confirm: null,
  toasts: [],
  tagFilter: null,
  searchQuery: '',

  openModal: (kind) => set({ modal: kind, contextMenu: null }),
  closeModal: () => set({ modal: null }),
  openSettings: (tab) => set({ modal: 'settings', settingsTab: tab ?? get().settingsTab }),
  showContextMenu: (menu) => set({ contextMenu: menu }),
  hideContextMenu: () => set({ contextMenu: null }),
  showPrompt: (prompt) => set({ prompt, contextMenu: null }),
  hidePrompt: () => set({ prompt: null }),
  showConfirm: (confirm) => set({ confirm, contextMenu: null }),
  hideConfirm: () => set({ confirm: null }),

  pushToast: (message, kind = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setTagFilter: (tag) => set({ tagFilter: tag }),
  setSearchQuery: (q) => set({ searchQuery: q })
}))

/** Convenience for non-component code. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  useUi.getState().pushToast(message, kind)
}
