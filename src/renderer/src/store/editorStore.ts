import { create } from 'zustand'
import { isPathAtOrBelow, rebaseDescendantPath } from '@shared/markdown-parse'
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
const saves = new Map<string, Promise<void>>()
const loads = new Map<string, symbol>()
let vaultGeneration = 0

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
    if (get().buffers[path] && !get().buffers[path].loading && !get().buffers[path].error) return
    const generation = vaultGeneration
    const request = Symbol(path)
    loads.set(path, request)
    set((s) => ({
      buffers: { ...s.buffers, [path]: { content: '', saved: '', mtime: 0, loading: true } }
    }))
    let res
    try {
      res = await window.lumina.notes.read(path)
    } catch (err) {
      res = { ok: false as const, error: (err as Error).message }
    }
    if (generation !== vaultGeneration || loads.get(path) !== request) return
    loads.delete(path)
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
    const generation = vaultGeneration
    const request = Symbol(path)
    loads.set(path, request)
    let res
    try {
      res = await window.lumina.notes.read(path)
    } catch (err) {
      res = { ok: false as const, error: (err as Error).message }
    }
    if (generation !== vaultGeneration || loads.get(path) !== request) return
    loads.delete(path)
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
    const existingSave = saves.get(path)
    if (existingSave) {
      await existingSave
      return get().save(path)
    }

    const buffer = get().buffers[path]
    if (!buffer || buffer.loading || buffer.content === buffer.saved) return

    const content = buffer.content
    const operation = (async (): Promise<void> => {
      set((s) => ({ saving: s.saving.includes(path) ? s.saving : [...s.saving, path] }))
      try {
        const res = await window.lumina.notes.write(path, content)
        if (!res.ok) {
          toast(`Could not save ${path}: ${res.error ?? 'unknown error'}`, 'error')
          return
        }
        // Only mark clean up to what we actually wrote; later keystrokes stay dirty.
        set((s) => {
          const current = s.buffers[path]
          if (!current) return s
          return {
            buffers: {
              ...s.buffers,
              [path]: { ...current, saved: content, mtime: res.mtime }
            }
          }
        })
      } catch (err) {
        toast(`Could not save ${path}: ${(err as Error).message}`, 'error')
      } finally {
        set((s) => ({ saving: s.saving.filter((p) => p !== path) }))
      }
    })()

    saves.set(path, operation)
    try {
      await operation
    } finally {
      if (saves.get(path) === operation) saves.delete(path)
    }
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
    vaultGeneration++
    loads.clear()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    saves.clear()
    set({ buffers: {}, saving: [] })
  },

  close: (path) => {
    for (const loadPath of [...loads.keys()]) {
      if (isPathAtOrBelow(loadPath, path)) loads.delete(loadPath)
    }
    for (const timerPath of [...timers.keys()]) {
      if (isPathAtOrBelow(timerPath, path)) cancelAutosave(timerPath)
    }
    set((s) => {
      const buffers = { ...s.buffers }
      for (const bufferPath of Object.keys(buffers)) {
        if (isPathAtOrBelow(bufferPath, path)) delete buffers[bufferPath]
      }
      return { buffers }
    })
  },

  rename: (from, to) => {
    const pendingSaves: string[] = []
    const pendingLoads: string[] = []
    set((s) => {
      const buffers: Record<string, Buffer> = {}
      for (const [bufferPath, buffer] of Object.entries(s.buffers)) {
        const nextPath = rebaseDescendantPath(bufferPath, from, to)
        buffers[nextPath] = buffer
        if (nextPath !== bufferPath && buffer.loading) pendingLoads.push(nextPath)
      }
      return { buffers }
    })
    for (const loadPath of [...loads.keys()]) {
      if (isPathAtOrBelow(loadPath, from)) loads.delete(loadPath)
    }
    for (const [timerPath, timer] of [...timers]) {
      if (!isPathAtOrBelow(timerPath, from)) continue
      clearTimeout(timer)
      timers.delete(timerPath)
      pendingSaves.push(rebaseDescendantPath(timerPath, from, to))
    }
    // The disk rename already happened, so pending edits must target new paths.
    for (const path of pendingSaves) void get().save(path)
    for (const path of pendingLoads) void get().open(path)
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
