import { create } from 'zustand'

export type ModalKind = 'palette' | 'switcher' | 'settings' | 'graph' | 'speechSetup' | null

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
  /** CSS color shown as a small swatch dot before the label, e.g. for a color picker. */
  swatch?: string
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

/**
 * The recorder, as much of it as the UI has to draw.
 *
 * The live `MediaRecorder` stays in `lib/voice.ts`; only the phase and the
 * start time are here, because a microphone is not serialisable state and two
 * copies of it would be one too many.
 */
export interface VoiceState {
  mode: 'note' | 'dictate'
  phase: 'starting' | 'recording' | 'saving' | 'transcribing'
  startedAt: number
  /**
   * Phrases sent to the speech model but not yet written back.
   *
   * Only live dictation sets this. It is what lets the bar say the words are
   * on their way rather than looking idle while someone waits for a sentence.
   */
  pending?: number
}

/**
 * Read aloud, as much of it as the player bar has to draw.
 *
 * The live `SpeechSynthesisUtterance` queue stays in `lib/readAloud.ts` for the
 * same reason the microphone stays in `lib/voice.ts`: a synthesizer is not
 * serialisable state, and two copies of it would be one too many.
 */
export interface SpeechState {
  /** What is being read — a note title, or "Selection". */
  label: string
  phase: 'speaking' | 'paused'
  /** Zero-based utterance being spoken, and how many there are. */
  index: number
  total: number
}

interface UiState {
  modal: ModalKind
  settingsTab: string
  contextMenu: ContextMenuState | null
  prompt: PromptState | null
  confirm: ConfirmState | null
  toasts: Toast[]
  /** Incremented for each successful manual save so its animation can replay. */
  savePulse: number
  /** Tag currently filtering the file list, or null. */
  tagFilter: string | null
  /** Search query shared between the search panel and its results. */
  searchQuery: string
  /** Pending scroll target, cleared by the editor once it has been applied. */
  reveal: RevealRequest | null
  /** The running voice recording, or null when the microphone is closed. */
  voice: VoiceState | null
  /** What read-aloud is speaking, or null when nothing is. */
  speech: SpeechState | null
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
  showSaveIndicator: () => void
  setTagFilter: (tag: string | null) => void
  setSearchQuery: (q: string) => void
  requestReveal: (target: Omit<RevealRequest, 'nonce'>) => void
  clearReveal: (nonce: number) => void
  setVoice: (voice: VoiceState | null) => void
  setVoicePending: (pending: number) => void
  setSpeech: (speech: SpeechState | null) => void
  setSpeechProgress: (index: number, phase?: SpeechState['phase']) => void
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
  savePulse: 0,
  tagFilter: null,
  searchQuery: '',
  reveal: null,
  voice: null,
  speech: null,
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
  showSaveIndicator: () => set((s) => ({ savePulse: s.savePulse + 1 })),

  setTagFilter: (tag) => set({ tagFilter: tag }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  requestReveal: (target) => set({ reveal: { ...target, nonce: ++revealId } }),
  // Only the editor that actually handled this request clears it, so a reveal
  // aimed at a note still loading is not thrown away by another one mounting.
  clearReveal: (nonce) => set((s) => (s.reveal?.nonce === nonce ? { reveal: null } : s)),

  setVoice: (voice) => set({ voice }),
  // Ignored when no recording is running, so a phrase landing after the user
  // stopped cannot revive the bar.
  setVoicePending: (pending) =>
    set((s) => (s.voice ? { voice: { ...s.voice, pending } } : s)),

  setSpeech: (speech) => set({ speech }),
  // Ignored once the bar is gone, so an utterance ending after the user pressed
  // stop cannot bring it back.
  setSpeechProgress: (index, phase) =>
    set((s) => (s.speech ? { speech: { ...s.speech, index, phase: phase ?? s.speech.phase } } : s)),

}))

/** Convenience for non-component code. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  useUi.getState().pushToast(message, kind)
}
