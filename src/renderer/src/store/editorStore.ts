import { create } from 'zustand'
import { useSettings } from './settingsStore'
import { toast } from './uiStore'

export interface Buffer {
  content: string
  /** Last content known to be on disk, for the dirty check. */
  saved: string
  mtime: number
  loading: boolean
  error?: string
}

interface EditorState {
  buffers: Record<string, Buffer>
  /** Paths with a save in flight, shown in the status bar. */
  saving: string[]

  open: (path: string) => Promise<void>
  reload: (path: string) => Promise<void>
  setContent: (path: string, content: string) => void
  save: (path: string) => Promise<void>
  saveAll: () => Promise<void>
  reset: () => void
  close: (path: string) => void
  rename: (from: string, to: string) => void
  externalChange: (path: string) => Promise<void>
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelAutosave(path: string): void {
  const t = timers.get(path)
  if (t) {
    clearTimeout(t)
    timers.delete(path)
  }
}

export const useEditor = create<EditorState>((set, get) => ({
  buffers: {},
  saving: [],

  open: async (path) => {
    if (get().buffers[path] && !get().buffers[path].loading) return
    set((s) => ({
      buffers: { ...s.buffers, [path]: { content: '', saved: '', mtime: 0, loading: true } }
    }))
    const res = await window.lumina.notes.read(path)
    set((s) => ({
      buffers: {
        ...s.buffers,
        [path]: res.ok && res.data
          ? { content: res.data.content, saved: res.data.content, mtime: res.data.mtime, loading: false }
          : { content: '', saved: '', mtime: 0, loading: false, error: res.error ?? 'Could not read the note' }
      }
    }))
  },

  reload: async (path) => {
    const res = await window.lumina.notes.read(path)
    if (!res.ok || !res.data) return
    set((s) => ({
      buffers: {
        ...s.buffers,
        [path]: { content: res.data!.content, saved: res.data!.content, mtime: res.data!.mtime, loading: false }
      }
    }))
  },

  setContent: (path, content) => {
    const buffer = get().buffers[path]
    if (!buffer || buffer.content === content) return
    set((s) => ({ buffers: { ...s.buffers, [path]: { ...buffer, content } } }))

    cancelAutosave(path)
    const delay = useSettings.getState().settings.editor.autosaveDelay
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path)
        void get().save(path)
      }, Math.max(120, delay))
    )
  },

  save: async (path) => {
    cancelAutosave(path)
    const buffer = get().buffers[path]
    if (!buffer || buffer.loading || buffer.content === buffer.saved) return

    const content = buffer.content
    set((s) => ({ saving: s.saving.includes(path) ? s.saving : [...s.saving, path] }))
    const res = await window.lumina.notes.write(path, content)
    set((s) => ({ saving: s.saving.filter((p) => p !== path) }))

    if (!res.ok) {
      toast(`Could not save ${path}: ${res.error ?? 'unknown error'}`, 'error')
      return
    }
    // Only mark clean up to what we actually wrote; later keystrokes stay dirty.
    set((s) => {
      const current = s.buffers[path]
      if (!current) return s
      return { buffers: { ...s.buffers, [path]: { ...current, saved: content, mtime: res.mtime } } }
    })
  },

  saveAll: async () => {
    const dirty = Object.entries(get().buffers)
      .filter(([, b]) => b.content !== b.saved)
      .map(([p]) => p)
    await Promise.all(dirty.map((p) => get().save(p)))
  },

  /**
   * Forget every buffer, for a switch to a different vault.
   *
   * Buffers are keyed by vault-relative path, so `Notes/Todo.md` in the vault
   * being left collides with `Notes/Todo.md` in the one being opened. Left in
   * place, `open` would short-circuit on the stale buffer and autosave would
   * then write the old vault's text into the new vault's file.
   */
  reset: () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    set({ buffers: {}, saving: [] })
  },

  close: (path) => {
    cancelAutosave(path)
    set((s) => {
      const buffers = { ...s.buffers }
      delete buffers[path]
      return { buffers }
    })
  },

  rename: (from, to) => {
    set((s) => {
      const buffer = s.buffers[from]
      if (!buffer) return s
      const buffers = { ...s.buffers }
      delete buffers[from]
      buffers[to] = buffer
      return { buffers }
    })
  },

  /**
   * A change arrived from the filesystem.
   *
   * A clean buffer silently takes the new content. A dirty one keeps the user's
   * unsaved work and says so, rather than choosing a winner on their behalf.
   */
  externalChange: async (path) => {
    const buffer = get().buffers[path]
    if (!buffer || buffer.loading) return
    if (buffer.content !== buffer.saved) {
      toast(`${path} changed on disk. Your unsaved edits are kept here.`, 'error')
      return
    }
    await get().reload(path)
  }
}))

export function isDirty(path: string): boolean {
  const b = useEditor.getState().buffers[path]
  return !!b && !b.loading && b.content !== b.saved
}

export function anyDirty(): boolean {
  return Object.values(useEditor.getState().buffers).some((b) => !b.loading && b.content !== b.saved)
}
