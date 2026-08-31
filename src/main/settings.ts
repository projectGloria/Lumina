import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Settings, ThemeFile, VaultInfo, WorkspaceState } from '@shared/types'
import { luminaDir } from './paths'

/* --------------------------------------------------------------- defaults */

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  editor: {
    fontSize: 16,
    lineHeight: 1.7,
    editorWidth: 46,
    readableLineLength: true,
    fontFamily: '',
    serifFamily: '',
    monoFamily: '',
    serifHeadings: true,
    spellcheck: true,
    showLineNumbers: false,
    autosaveDelay: 400,
    livePreview: true,
    smartLists: true
  },
  dailyNotes: {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: ''
  },
  attachmentFolder: 'attachments',
  templateFolder: 'Templates',
  hotkeys: {},
  snippets: {},
  starred: [],
  graphPerformanceMode: false
}

export const DEFAULT_THEME: ThemeFile = { preset: 'claude', light: {}, dark: {} }

export const DEFAULT_WORKSPACE: WorkspaceState = {
  tabs: [],
  activeTab: 0,
  leftOpen: true,
  rightOpen: true,
  leftWidth: 260,
  rightWidth: 300,
  leftPanel: 'files',
  rightPanel: 'backlinks',
  expanded: [],
  focusMode: false
}

/* ---------------------------------------------------------------- helpers */

/** Merge stored JSON over defaults, one level into plain objects. */
function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k]
    if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object') {
      out[k] = merge(b, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return merge(fallback, JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const previous = writeQueues.get(file) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tmp, file)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
  })
  writeQueues.set(file, operation)
  try {
    await operation
  } finally {
    if (writeQueues.get(file) === operation) writeQueues.delete(file)
  }
}

const writeQueues = new Map<string, Promise<void>>()

/* ------------------------------------------------------- app-level state */

interface AppState {
  recentVaults: VaultInfo[]
  lastVault: string | null
  windowBounds?: { width: number; height: number; x?: number; y?: number }
  // App-level so a rebind follows you across vaults instead of being pinned to
  // the vault it was recorded in. Kept out of `Settings` on disk (see
  // `loadSettings`/`saveSettings`) even though `Settings.hotkeys` still exists
  // in memory for the renderer.
  hotkeys: Record<string, string>
}

const APP_STATE_DEFAULT: AppState = { recentVaults: [], lastVault: null, hotkeys: {} }

const appStateFile = (): string => path.join(app.getPath('userData'), 'lumina.json')
let appStateUpdates: Promise<void> = Promise.resolve()

export async function loadAppState(): Promise<AppState> {
  return readJson(appStateFile(), APP_STATE_DEFAULT)
}

export async function saveAppState(patch: Partial<AppState>): Promise<void> {
  appStateUpdates = appStateUpdates.catch(() => {}).then(async () => {
    const current = await loadAppState()
    await writeJson(appStateFile(), { ...current, ...patch })
  })
  await appStateUpdates
}

export async function rememberVault(vaultPath: string): Promise<void> {
  appStateUpdates = appStateUpdates.catch(() => {}).then(async () => {
    const state = await loadAppState()
    const name = path.basename(vaultPath)
    const recent = state.recentVaults.filter((v) => v.path !== vaultPath)
    recent.unshift({ path: vaultPath, name, lastOpened: Date.now() })
    await writeJson(appStateFile(), {
      ...state,
      recentVaults: recent.slice(0, 12),
      lastVault: vaultPath
    })
  })
  await appStateUpdates
}

/* ----------------------------------------------------- vault-level state */

export { luminaDir }

const settingsFile = (v: string): string => path.join(luminaDir(v), 'settings.json')
const themeFile = (v: string): string => path.join(luminaDir(v), 'theme.json')
const workspaceFile = (v: string): string => path.join(luminaDir(v), 'workspace.json')

export const cacheFile = (v: string): string => path.join(luminaDir(v), 'cache.json')
export const snippetsDir = (v: string): string => path.join(luminaDir(v), 'snippets')

export async function ensureLuminaDir(vault: string): Promise<void> {
  const ensureRealDirectory = async (dir: string): Promise<void> => {
    try {
      const stat = await fs.lstat(dir)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${dir} must be a real directory`)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      await fs.mkdir(dir).catch((mkdirErr) => {
        if ((mkdirErr as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirErr
      })
      const stat = await fs.lstat(dir)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${dir} must be a real directory`)
      }
    }
  }

  // Metadata must stay beside the vault; never follow a planted `.lumina`
  // or `snippets` symlink into an unrelated directory.
  await ensureRealDirectory(luminaDir(vault))
  await ensureRealDirectory(snippetsDir(vault))
}

/**
 * Settings are per-vault on disk, except `hotkeys`, which lives in app-level
 * `lumina.json` (see `AppState`) so a rebind follows you between vaults. A
 * vault settings.json written by an older Lumina may still carry a `hotkeys`
 * object; the first load here migrates it into app state (without
 * overwriting an app-level override already set) and strips it going
 * forward.
 */
export async function loadSettings(v: string): Promise<Settings> {
  const [raw, appState] = await Promise.all([
    readJson<Settings & { hotkeys?: Record<string, string> }>(settingsFile(v), DEFAULT_SETTINGS),
    loadAppState()
  ])

  const legacy = raw.hotkeys
  if (legacy && Object.keys(legacy).length) {
    await saveAppState({ hotkeys: { ...legacy, ...appState.hotkeys } })
    await writeJson(settingsFile(v), { ...raw, hotkeys: {} })
    return { ...raw, hotkeys: { ...legacy, ...appState.hotkeys } }
  }

  return { ...raw, hotkeys: appState.hotkeys }
}

export async function saveSettings(v: string, s: Settings): Promise<void> {
  await Promise.all([writeJson(settingsFile(v), { ...s, hotkeys: {} }), saveAppState({ hotkeys: s.hotkeys })])
}

export const loadTheme = (v: string): Promise<ThemeFile> => readJson(themeFile(v), DEFAULT_THEME)

export const saveTheme = (v: string, t: ThemeFile): Promise<void> => writeJson(themeFile(v), t)

export const loadWorkspace = (v: string): Promise<WorkspaceState> =>
  readJson(workspaceFile(v), DEFAULT_WORKSPACE)

export const saveWorkspace = (v: string, w: WorkspaceState): Promise<void> =>
  writeJson(workspaceFile(v), w)

export { readJson, writeJson }
