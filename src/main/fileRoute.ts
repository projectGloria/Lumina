/**
 * Which of the two applications a file the OS handed us belongs to.
 *
 * Lumina is a vault app and a text editor sharing one executable, and a
 * double-click has to pick one before anything is on screen. The rule is the
 * narrow one: a markdown note that is actually *inside* a vault opens in Vault,
 * because that is the only case where the tree, the index, the backlinks and
 * the graph have anything to say about it. Everything else — a `.txt`, a
 * `.json`, a config file, or a markdown file sitting in Downloads — opens in
 * Quick Note, which needs no vault and no index and is up in a fraction of the
 * time.
 *
 * This runs in `index.ts` *before* `app.ready`, so every check here is
 * synchronous and cheap. It is also free of any `electron` import, for the
 * reason `netGuard.ts` and `openFile.ts` are: the decision is the part that is
 * easy to get subtly wrong, and `tests/fileRoute.test.ts` should not have to
 * stand up Electron to pin it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isTextDocumentPath } from '@shared/textFiles'
import { ancestorDirs, argPathsFrom, isMarkdown, luminaDir, vaultContaining } from './paths'

export type LaunchTarget = 'vault' | 'quicknote'

export interface RouteEnv {
  /** True when `dir` carries a `.lumina` folder, i.e. Lumina has opened it. */
  isVaultDir: (dir: string) => boolean
  /** Vault roots the app remembers, from `lumina.json`. */
  knownVaults: string[]
}

/**
 * File arguments on a command line, in the order the OS gave them.
 *
 * Electron shifts argv by one when the app is not packaged, because the app
 * directory sits between the binary and the real arguments. Switches are
 * dropped so Chromium's own flags never look like a file. This is the wider
 * sibling of `fileArgsFrom` in `paths.ts`: that one answers "which of these are
 * notes", this one "which of these are documents at all", and the difference is
 * the whole point of the feature.
 */
export function documentArgsFrom(argv: string[], packaged: boolean): string[] {
  return argPathsFrom(argv, packaged, isTextDocumentPath)
}

/** Whether this path is a markdown note living inside a folder Lumina knows. */
export function isVaultNote(filePath: string, env: RouteEnv): boolean {
  if (!isMarkdown(filePath)) return false

  const abs = path.resolve(filePath)
  // A real `.lumina` marker is proof; the deepest one wins, which is what lets
  // a vault nested inside another still claim its own notes.
  for (const candidate of ancestorDirs(path.dirname(abs))) {
    if (env.isVaultDir(candidate)) return true
  }
  // Failing a marker on disk, a root the app remembers counts too — a vault
  // whose `.lumina` folder was deleted is still the vault the user works in.
  return vaultContaining(abs, env.knownVaults) !== null
}

/**
 * The application these files should open in.
 *
 * Decided on the *first* file rather than by voting, because a multi-select
 * that mixes a vault note with a stray `.txt` has no single right answer and
 * splitting one launch across two processes would be a worse one. Quick Note
 * can open anything, including a vault note, so a mixed selection that lands
 * there still shows every file the user picked; Vault quietly ignores what it
 * cannot display. Nothing is dropped either way.
 */
export function routeForFiles(files: string[], env: RouteEnv): LaunchTarget {
  const first = files.find((file) => !!file)
  // No file argument at all is an ordinary launch, which is Vault's.
  if (!first) return 'vault'
  return isVaultNote(first, env) ? 'vault' : 'quicknote'
}

/** A `.lumina` folder is what a vault leaves behind. Synchronous by design. */
function isVaultDirSync(dir: string): boolean {
  try {
    return fs.statSync(luminaDir(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Vault roots recorded in `lumina.json` — the active profile's, every
 * profile's, the last one opened and the recent list.
 *
 * Read with `readFileSync` and forgiving of everything: this is a routing hint,
 * and a corrupt or absent config should send a file to Quick Note rather than
 * fail the launch. `userDataDir` is passed in because the caller has to read it
 * before the Quick Note branch moves `userData` somewhere else.
 */
export function readKnownVaults(userDataDir: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'lumina.json'), 'utf8')
    const state = JSON.parse(raw.replace(/^﻿/, '')) as {
      lastVault?: unknown
      recentVaults?: unknown
      profiles?: unknown
    }

    const out: string[] = []
    const add = (value: unknown): void => {
      if (typeof value === 'string' && value && path.isAbsolute(value)) out.push(value)
    }

    add(state.lastVault)
    if (Array.isArray(state.recentVaults)) {
      for (const entry of state.recentVaults) add((entry as { path?: unknown })?.path)
    }
    if (Array.isArray(state.profiles)) {
      for (const entry of state.profiles) add((entry as { vaultPath?: unknown })?.vaultPath)
    }
    return out
  } catch {
    return []
  }
}

/** The routing environment backed by the real filesystem and config. */
export function liveRouteEnv(userDataDir: string): RouteEnv {
  return { isVaultDir: isVaultDirSync, knownVaults: readKnownVaults(userDataDir) }
}
