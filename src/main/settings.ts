import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Settings, ThemeFile, VaultInfo, WorkspaceState } from '@shared/types'

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
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

/* ------------------------------------------------------- app-level state */

interface AppState {
  recentVaults: VaultInfo[]
  lastVault: string | null
  windowBounds?: { width: number; height: number; x?: number; y?: number }
}

const APP_STATE_DEFAULT: AppState = { recentVaults: [], lastVault: null }

const appStateFile = (): string => path.join(app.getPath('userData'), 'lumina.json')

export async function loadAppState(): Promise<AppState> {
  return readJson(appStateFile(), APP_STATE_DEFAULT)
}

export async function saveAppState(patch: Partial<AppState>): Promise<void> {
  const current = await loadAppState()
  await writeJson(appStateFile(), { ...current, ...patch })
}

export async function rememberVault(vaultPath: string): Promise<void> {
  const state = await loadAppState()
  const name = path.basename(vaultPath)
  const recent = state.recentVaults.filter((v) => v.path !== vaultPath)
  recent.unshift({ path: vaultPath, name, lastOpened: Date.now() })
  await saveAppState({ recentVaults: recent.slice(0, 12), lastVault: vaultPath })
}

/* ----------------------------------------------------- vault-level state */

export const luminaDir = (vault: string): string => path.join(vault, '.lumina')

const settingsFile = (v: string): string => path.join(luminaDir(v), 'settings.json')
const themeFile = (v: string): string => path.join(luminaDir(v), 'theme.json')
const workspaceFile = (v: string): string => path.join(luminaDir(v), 'workspace.json')

export const cacheFile = (v: string): string => path.join(luminaDir(v), 'cache.json')
export const snippetsDir = (v: string): string => path.join(luminaDir(v), 'snippets')

export async function ensureLuminaDir(vault: string): Promise<void> {
  await fs.mkdir(snippetsDir(vault), { recursive: true })
}

export const loadSettings = (v: string): Promise<Settings> =>
  readJson(settingsFile(v), DEFAULT_SETTINGS)

export const saveSettings = (v: string, s: Settings): Promise<void> =>
  writeJson(settingsFile(v), s)

export const loadTheme = (v: string): Promise<ThemeFile> => readJson(themeFile(v), DEFAULT_THEME)

export const saveTheme = (v: string, t: ThemeFile): Promise<void> => writeJson(themeFile(v), t)

export const loadWorkspace = (v: string): Promise<WorkspaceState> =>
  readJson(workspaceFile(v), DEFAULT_WORKSPACE)

export const saveWorkspace = (v: string, w: WorkspaceState): Promise<void> =>
  writeJson(workspaceFile(v), w)

export { readJson, writeJson }
