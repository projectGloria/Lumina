import { create } from 'zustand'
import type { TreeNode, VaultIndex, VaultInfo } from '@shared/types'
import { emptyIndex } from '@shared/types'
import {
  buildAliasMap,
  dirname,
  isMarkdownPath,
  joinPath,
  normalizePath,
  stripExtension
} from '@shared/markdown-parse'

interface VaultState {
  vault: VaultInfo | null
  tree: TreeNode[]
  index: VaultIndex
  recent: VaultInfo[]
  /** True while the initial index build is in flight. */
  loading: boolean

  setVault: (vault: VaultInfo, tree: TreeNode[], index: VaultIndex) => void
  setTree: (tree: TreeNode[]) => void
  setIndex: (index: VaultIndex) => void
  setRecent: (recent: VaultInfo[]) => void
  setLoading: (loading: boolean) => void
}

export const useVault = create<VaultState>((set) => ({
  vault: null,
  tree: [],
  index: emptyIndex(),
  recent: [],
  loading: false,

  setVault: (vault, tree, index) => set({ vault, tree, index, loading: false }),
  setTree: (tree) => set({ tree }),
  setIndex: (index) => set({ index }),
  setRecent: (recent) => set({ recent }),
  setLoading: (loading) => set({ loading })
}))

/* ------------------------------------------------------------- helpers */

/** Display title for a path, preferring the indexed title. */
export function titleOf(path: string): string {
  const entry = useVault.getState().index.notes[path]
  return entry?.title ?? stripExtension(path.split('/').pop() ?? path)
}

/** Every note path known to the index, used for link resolution in the editor. */
export function knownPaths(): string[] {
  return Object.keys(useVault.getState().index.notes)
}

// Rebuilding the alias map on every decoration pass would be wasteful, and the
// index is replaced wholesale on change, so identity is a sound cache key.
let aliasCacheKey: VaultIndex | null = null
let aliasCache = new Map<string, string>()

/** Titles and frontmatter aliases mapped to the notes that claim them. */
export function aliasMap(): ReadonlyMap<string, string> {
  const index = useVault.getState().index
  if (index !== aliasCacheKey) {
    aliasCacheKey = index
    aliasCache = buildAliasMap(Object.values(index.notes))
  }
  return aliasCache
}

/**
 * Where a note created from an unresolved link should live.
 *
 * A bare target lands next to the note that referenced it, which keeps
 * folder-organised vaults tidy; a target with slashes is taken literally.
 */
export function pathForNewNote(target: string, fromPath: string | null): string {
  const t = normalizePath(target)
  if (t.includes('/')) return isMarkdownPath(t) ? t : `${t}.md`
  const folder = fromPath ? dirname(fromPath) : ''
  return joinPath(folder, isMarkdownPath(t) ? t : `${t}.md`)
}
