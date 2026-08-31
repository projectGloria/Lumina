import fs from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { shell } from 'electron'
import { ensureLuminaDir, snippetsDir } from './settings'

export interface Snippet {
  /** File name including `.css`, used as the stable id. */
  name: string
  css: string
}

let watcher: FSWatcher | null = null
let reloadTimer: NodeJS.Timeout | null = null

/** Read every `.css` file in the vault snippets folder. */
export async function readSnippets(vault: string): Promise<Snippet[]> {
  const dir = snippetsDir(vault)
  try {
    const files = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase().endsWith('.css'))
      .map((entry) => entry.name)
      .sort()
    return await Promise.all(
      files.map(async (name) => ({
        name,
        css: await fs.readFile(path.join(dir, name), 'utf8').catch(() => '')
      }))
    )
  } catch {
    return []
  }
}

/**
 * Watch the snippets folder so dropping in or editing a `.css` file takes
 * effect without a restart.
 */
export function startSnippetWatcher(vault: string, onChange: (s: Snippet[]) => void): void {
  void stopSnippetWatcher()

  const dir = snippetsDir(vault)
  const reload = (): void => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void readSnippets(vault).then(onChange)
    }, 100)
  }

  watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 30 }
  })
  watcher.on('all', reload).on('error', () => {})
}

export async function stopSnippetWatcher(): Promise<void> {
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  if (watcher) {
    const w = watcher
    watcher = null
    await w.close().catch(() => {})
  }
}

export async function openSnippetsFolder(vault: string): Promise<void> {
  const dir = snippetsDir(vault)
  await ensureLuminaDir(vault)
  await shell.openPath(dir)
}
