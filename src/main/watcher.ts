import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { VaultChange, VaultChangeType } from '@shared/types'
import { isIgnored, isMarkdown, toRelative } from './paths'
import { wasSelfWrite } from './vault'

let watcher: FSWatcher | null = null
let pending = new Map<string, VaultChange>()
let flushTimer: NodeJS.Timeout | null = null

export type ChangeHandler = (changes: VaultChange[]) => void

/**
 * Watch the vault for edits made outside the app.
 *
 * Events are batched: a folder rename or a git checkout can fire hundreds at
 * once, and the renderer only needs one reconcile pass.
 */
export function startWatcher(vault: string, onChange: ChangeHandler): void {
  void stopWatcher()

  const root = path.resolve(vault)

  const queue = (type: VaultChangeType, abs: string): void => {
    if (wasSelfWrite(abs)) return
    const rel = toRelative(root, abs)
    if (!rel || rel.startsWith('..') || isIgnored(rel)) return
    if ((type === 'add' || type === 'change' || type === 'unlink') && !isMarkdown(rel)) return
    if (rel.endsWith('.lumina-tmp')) return

    pending.set(`${type}:${rel}`, { type, path: rel })
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      const batch = [...pending.values()]
      pending = new Map()
      if (batch.length) onChange(batch)
    }, 120)
  }

  watcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    depth: 12,
    ignored: (p: string) => {
      const rel = toRelative(root, p)
      return rel !== '' && (rel.startsWith('..') || isIgnored(rel))
    },
    // Editors write in stages; wait until the file stops growing.
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
  })

  watcher
    .on('add', (p) => queue('add', p))
    .on('change', (p) => queue('change', p))
    .on('unlink', (p) => queue('unlink', p))
    .on('addDir', (p) => queue('addDir', p))
    .on('unlinkDir', (p) => queue('unlinkDir', p))
    .on('error', () => {
      // A transient watch error should not take the app down.
    })
}

export async function stopWatcher(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pending = new Map()
  if (watcher) {
    const w = watcher
    watcher = null
    await w.close().catch(() => {})
  }
}
