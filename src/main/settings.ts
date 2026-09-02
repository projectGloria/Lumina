import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  CustomSlashCommand,
  Profile,
  QuickNoteSettings,
  Settings,
  SettingsPreset,
  ThemeFile,
  VaultInfo,
  WorkspaceState
} from '@shared/types'
import { luminaDir } from './paths'
import { DEFAULT_QUICK_NOTE } from './quickNote'

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
    smartLists: true,
    showWordCount: false,
    linkPreviews: false
  },
  dailyNotes: {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: ''
  },
  attachmentFolder: 'attachments',
  templateFolder: 'Templates',
  hotkeys: {},
  // Both of these are overlaid from app-level state on load; the values here
  // only matter for a vault whose settings.json predates the split.
  slashCommands: [],
  quickNote: DEFAULT_QUICK_NOTE,
  snippets: {},
  starred: [],
  graphPerformanceMode: false,
  iconOverrides: {},
  colorOverrides: {},
  customIcons: {},
  pinned: [],
  sortOrder: 'name',
  showFileTypes: false
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

export const normalizeSettings = (value: unknown): Settings => merge(DEFAULT_SETTINGS, value)
export const normalizeTheme = (value: unknown): ThemeFile => merge(DEFAULT_THEME, value)

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    // These files are meant to be editable by hand, and a Windows editor will
    // happily save one with a BOM - which `JSON.parse` rejects. Silently
    // falling back to defaults there loses the user's settings on the next
    // write, so strip it rather than treat the file as unreadable.
    const raw = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '')
    return merge(fallback, JSON.parse(raw))
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

export interface AppState {
  recentVaults: VaultInfo[]
  lastVault: string | null
  windowBounds?: { width: number; height: number; x?: number; y?: number }
  // App-level so a rebind follows you across vaults instead of being pinned to
  // the vault it was recorded in. Kept out of `Settings` on disk (see
  // `loadSettings`/`saveSettings`) even though `Settings.hotkeys` still exists
  // in memory for the renderer.
  hotkeys: Record<string, string>
  /** The user's `/` snippets, app-level for the same reason as `hotkeys`. */
  slashCommands: CustomSlashCommand[]
  /**
   * Quick-note preferences. App-level because the main process acts on them
   * (a global accelerator, a tray icon, a login item) with no vault involved.
   */
  quickNote: QuickNoteSettings
  profiles: Profile[]
  activeProfileId: string | null
  settingsProfiles: SettingsPreset[]
}

/**
 * A couple of snippets to open the box with, so the settings tab shows what a
 * custom command looks like rather than an empty list. They are seeded only
 * when `lumina.json` has no `slashCommands` key at all — `merge` replaces
 * arrays wholesale, so deleting them all sticks.
 */
const STARTER_SLASH_COMMANDS: CustomSlashCommand[] = [
  {
    id: 'starter-meeting',
    name: 'meeting',
    description: 'Meeting note skeleton',
    body: '## Meeting — {{date}}\n\n**Present:** {{cursor}}\n\n### Notes\n\n- \n\n### Actions\n\n- [ ] '
  },
  {
    id: 'starter-stamp',
    name: 'stamp',
    description: "Today's date and time",
    body: '{{date}} {{time}}'
  }
]

const APP_STATE_DEFAULT: AppState = {
  recentVaults: [],
  lastVault: null,
  hotkeys: {},
  slashCommands: STARTER_SLASH_COMMANDS,
  quickNote: DEFAULT_QUICK_NOTE,
  profiles: [],
  activeProfileId: null,
  settingsProfiles: []
}

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
 * Settings are per-vault on disk, except `hotkeys`, `slashCommands` and
 * `quickNote`, which live in app-level `lumina.json` (see `AppState`) so a
 * rebind or a snippet follows you between vaults, and the quick-note shortcut
 * works before any vault is open at all. A vault settings.json written by an older
 * Lumina may still carry a `hotkeys` object; the first load here migrates it
 * into app state (without overwriting an app-level override already set) and
 * strips it going forward.
 */
export async function loadSettings(v: string): Promise<Settings> {
  const [raw, appState] = await Promise.all([
    readJson<Settings & { hotkeys?: Record<string, string> }>(settingsFile(v), DEFAULT_SETTINGS),
    loadAppState()
  ])

  const appLevel = {
    hotkeys: appState.hotkeys,
    slashCommands: appState.slashCommands,
    quickNote: appState.quickNote
  }

  const legacy = raw.hotkeys
  if (legacy && Object.keys(legacy).length) {
    await saveAppState({ hotkeys: { ...legacy, ...appState.hotkeys } })
    await writeJson(settingsFile(v), { ...raw, hotkeys: {} })
    return { ...raw, ...appLevel, hotkeys: { ...legacy, ...appState.hotkeys } }
  }

  return { ...raw, ...appLevel }
}

export async function saveSettings(v: string, s: Settings): Promise<void> {
  await Promise.all([
    writeJson(settingsFile(v), {
      ...s,
      hotkeys: {},
      slashCommands: [],
      quickNote: DEFAULT_QUICK_NOTE
    }),
    saveAppState({
      hotkeys: s.hotkeys,
      slashCommands: s.slashCommands,
      quickNote: s.quickNote
    })
  ])
}

export const loadTheme = (v: string): Promise<ThemeFile> => readJson(themeFile(v), DEFAULT_THEME)

export const saveTheme = (v: string, t: ThemeFile): Promise<void> => writeJson(themeFile(v), t)

export const loadWorkspace = (v: string): Promise<WorkspaceState> =>
  readJson(workspaceFile(v), DEFAULT_WORKSPACE)

export const saveWorkspace = (v: string, w: WorkspaceState): Promise<void> =>
  writeJson(workspaceFile(v), w)

export { readJson, writeJson }
