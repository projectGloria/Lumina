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

/**
 * A heading or line the editor should scroll to once the note is in view.
 *
 * `nonce` makes two requests for the same place distinguishable, so clicking
 * the same search hit twice scrolls back to it rather than being ignored as an
 * unchanged value.
 */
export interface RevealRequest {
  path: string
  anchor?: string
  line?: number
  nonce: number
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
  /** Pending scroll target, cleared by the editor once it has been applied. */
  reveal: RevealRequest | null
  /** Rendered, non-editable view of the active note instead of the CodeMirror editor. */
  readMode: boolean

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
  requestReveal: (target: Omit<RevealRequest, 'nonce'>) => void
  clearReveal: (nonce: number) => void
  toggleReadMode: () => void
}

let toastId = 0
let revealId = 0

export const useUi = create<UiState>((set, get) => ({
  modal: null,
  settingsTab: 'appearance',
  contextMenu: null,
  prompt: null,
  confirm: null,
  toasts: [],
  tagFilter: null,
  searchQuery: '',
  reveal: null,
  readMode: false,

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
  setSearchQuery: (q) => set({ searchQuery: q }),

  requestReveal: (target) => set({ reveal: { ...target, nonce: ++revealId } }),
  // Only the editor that actually handled this request clears it, so a reveal
  // aimed at a note still loading is not thrown away by another one mounting.
  clearReveal: (nonce) => set((s) => (s.reveal?.nonce === nonce ? { reveal: null } : s)),

  toggleReadMode: () => set((s) => ({ readMode: !s.readMode }))
}))

/** Convenience for non-component code. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  useUi.getState().pushToast(message, kind)
}
