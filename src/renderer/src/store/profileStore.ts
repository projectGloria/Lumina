import { create } from 'zustand'
import type { Profile } from '@shared/types'
import { useEditor } from './editorStore'
import { useVault } from './vaultStore'
import { WORKSPACE_INITIAL, useWorkspace } from './workspaceStore'

type Status = 'loading' | 'picker' | 'locked' | 'ready'

interface ProfileStore {
  profiles: Profile[]
  /** The profile currently unlocked/selected this session, once `status` is 'ready'. */
  activeId: string | null
  /** The profile waiting on a password, while `status` is 'locked'. */
  pendingId: string | null
  status: Status
  error: string | null

  init: () => Promise<void>
  refresh: () => Promise<void>
  select: (id: string) => void
  unlock: (password: string) => Promise<void>
  cancelUnlock: () => void
  create: (name: string) => Promise<void>
  signOut: () => Promise<void>
  noteVaultPath: (vaultPath: string) => void
}

export const useProfiles = create<ProfileStore>((set, get) => ({
  profiles: [],
  activeId: null,
  pendingId: null,
  status: 'loading',
  error: null,

  init: async () => {
    const { profiles, activeProfileId } = await window.lumina.profiles.list()
    set({ profiles })

    const active = activeProfileId ? profiles.find((p) => p.id === activeProfileId) : null
    if (!active) {
      set({ status: 'picker' })
      return
    }
    if (active.passwordHash) {
      // Re-locks every launch — being "active" from a previous session does not
      // skip the passlock.
      set({ status: 'locked', pendingId: active.id })
      return
    }
    await finalize(active.id)
  },

  refresh: async () => {
    const { profiles } = await window.lumina.profiles.list()
    set({ profiles })
  },

  select: (id) => {
    const profile = get().profiles.find((p) => p.id === id)
    if (!profile) return
    if (profile.passwordHash) {
      set({ status: 'locked', pendingId: id, error: null })
    } else {
      void finalize(id)
    }
  },

  unlock: async (password) => {
    const id = get().pendingId
    if (!id) return
    const ok = await window.lumina.profiles.unlock(id, password)
    if (!ok) {
      set({ error: 'Wrong password' })
      return
    }
    set({ error: null })
    await finalize(id)
  },

  cancelUnlock: () => set({ status: 'picker', pendingId: null, error: null }),

  create: async (name) => {
    const profile = await window.lumina.profiles.create(name)
    set((s) => ({ profiles: [...s.profiles, profile] }))
    await finalize(profile.id)
  },

  signOut: async () => {
    await window.lumina.profiles.signOut()
    set({ status: 'picker', activeId: null, pendingId: null })
  },

  /** Called once a vault finishes opening, so the active profile remembers it next time. */
  noteVaultPath: (vaultPath) => {
    const id = get().activeId
    const profile = get().profiles.find((p) => p.id === id)
    if (!id || !profile || profile.vaultPath === vaultPath) return
    void window.lumina.profiles.setVault(id, vaultPath)
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, vaultPath } : p))
    }))
  }
}))

async function finalize(id: string): Promise<void> {
  const profile = useProfiles.getState().profiles.find((p) => p.id === id)
  if (!profile) return
  if (!profile.passwordHash) await window.lumina.profiles.switch(id)
  useProfiles.setState({ status: 'ready', activeId: id, pendingId: null, error: null })
  if (profile.vaultPath) {
    try {
      await window.lumina.vault.open(profile.vaultPath)
      return
    } catch {
      // Folder moved or deleted — fall through to the welcome screen, same as
      // the old lastVault auto-open behaviour.
    }
  }
  // No vault for this profile yet (or it failed to open) — drop whatever the
  // previous profile had in view rather than leaking it through.
  useVault.getState().clearVault()
  useEditor.getState().reset()
  useWorkspace.getState().hydrate(WORKSPACE_INITIAL)
}
