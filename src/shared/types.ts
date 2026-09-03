/** Types shared across the main process, preload bridge and renderer. */
import type { CustomSlashCommand } from './slashItems'

export type { CustomSlashCommand }

/* ------------------------------------------------------------------ vault */

export interface VaultInfo {
  /** Absolute path on disk. */
  path: string
  /** Folder name, used as the display name. */
  name: string
  /** Epoch ms of the last time this vault was opened. */
  lastOpened: number
}

/* --------------------------------------------------------------- profiles */

export interface Profile {
  id: string
  name: string
  /** Absolute path on disk, or null until the user picks/creates a vault for this profile. */
  vaultPath: string | null
  /**
   * `scrypt` hash and salt, `hex:hex`, or null when the profile has no passlock.
   * This gates the app's UI only — it does not encrypt anything on disk.
   */
  passwordHash: string | null
  /** Avatar background color, since there's no image upload. */
  color: string
}

export interface FileNode {
  kind: 'file'
  /** Vault-relative path with forward slashes, e.g. `Projects/Gloria.md`. */
  path: string
  /** File name including extension. */
  name: string
  /** Display title: frontmatter `title`, else the basename without extension. */
  title: string
  mtime: number
  createdAt: number
  size: number
}

export interface FolderNode {
  kind: 'folder'
  path: string
  name: string
  children: TreeNode[]
}

export type TreeNode = FileNode | FolderNode

/* ------------------------------------------------------------------ index */

export interface Heading {
  level: number
  text: string
  /** Zero-based line number. */
  line: number
}

export interface LinkRef {
  /** Vault-relative path of the note containing the link. */
  from: string
  /** Raw target exactly as typed inside `[[ ]]`. */
  target: string
  /** Resolved vault-relative path, or `null` when the note does not exist yet. */
  to: string | null
  alias?: string
  /** Heading or block anchor after `#`. */
  anchor?: string
  line: number
  /** The full source line, used as backlink context. */
  context: string
  /** `embed` for `![[...]]`, `link` for `[[...]]`. */
  kind: 'link' | 'embed'
}

/** One `- [ ]` line, as the index sees it. */
export interface Task {
  /** The text after the checkbox, exactly as written. */
  text: string
  done: boolean
  /** Zero-based line in the note, so a change can be written back to it. */
  line: number
}

export interface NoteIndexEntry {
  path: string
  title: string
  /** Other names this note answers to, from frontmatter `aliases`. */
  aliases: string[]
  mtime: number
  /** File creation time, ms since epoch. */
  createdAt: number
  wordCount: number
  headings: Heading[]
  tags: string[]
  links: LinkRef[]
  tasks: Task[]
  frontmatter: Record<string, unknown>
  /** First ~200 chars of body text, for search results and graph tooltips. */
  excerpt: string
}

export interface VaultIndex {
  /** Keyed by vault-relative path. */
  notes: Record<string, NoteIndexEntry>
  /** Note path -> links pointing at it. */
  backlinks: Record<string, LinkRef[]>
  /** Tag (without `#`) -> note paths. */
  tags: Record<string, string[]>
  /** Links whose target does not resolve to an existing note. */
  unresolved: LinkRef[]
}

export const emptyIndex = (): VaultIndex => ({
  notes: {},
  backlinks: {},
  tags: {},
  unresolved: []
})

/* --------------------------------------------------------------- settings */

export type ThemeMode = 'light' | 'dark' | 'system'

/** Map of `--lum-*` token name (without the `--lum-` prefix) to CSS value. */
export type TokenOverrides = Record<string, string>

export interface ThemeFile {
  /** Name of the active preset the overrides are layered on top of. */
  preset: string
  light: TokenOverrides
  dark: TokenOverrides
}

/** A named, portable snapshot that can be switched without losing alternatives. */
export interface SettingsPreset {
  id: string
  name: string
  createdAt: number
  settings: Settings
  theme: ThemeFile
}

export interface EditorSettings {
  fontSize: number
  lineHeight: number
  /** Max line measure in rem when `readableLineLength` is on. */
  editorWidth: number
  readableLineLength: boolean
  fontFamily: string
  serifFamily: string
  monoFamily: string
  /** Serif headings, Claude-style. */
  serifHeadings: boolean
  spellcheck: boolean
  showLineNumbers: boolean
  /** Debounce in ms before an edit is flushed to disk. */
  autosaveDelay: number
  /** Live preview hides markdown markers away from the cursor. */
  livePreview: boolean
  /** Insert `- ` / `1. ` continuation on Enter inside a list. */
  smartLists: boolean
  /** Show a live word/character count under the editor. */
  showWordCount: boolean
  /**
   * Fetch page titles and thumbnails for link banners. Off by default: with it
   * off Lumina makes no network requests at all.
   */
  linkPreviews: boolean
}

export interface DailyNoteSettings {
  folder: string
  /** `YYYY-MM-DD` style tokens. */
  format: string
  /** Vault-relative template path, or '' for none. */
  template: string
}

export interface QuickNoteSettings {
  /**
   * Electron accelerator for the OS-wide shortcut, or '' to turn it off.
   * Electron cannot tell left modifiers from right ones, so `Control+Shift+Space`
   * answers to either Ctrl and either Shift.
   */
  accelerator: string
  /** Vault-relative folder quick notes are created in. */
  folder: string
  /** Start Lumina with the OS, into the tray, so the shortcut works from boot. */
  startAtLogin: boolean
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean
  /** Build the window while idling in the tray, trading memory for a faster first note. */
  preloadWindow: boolean
}

export interface Settings {
  themeMode: ThemeMode
  editor: EditorSettings
  dailyNotes: DailyNoteSettings
  /** Folder new attachments are copied into. */
  attachmentFolder: string
  /** Folder templates are read from. */
  templateFolder: string
  /** Command id -> accelerator, overriding the built-in default. */
  hotkeys: Record<string, string>
  /**
   * The user's own `/` snippets. App-level on disk, like `hotkeys` — see
   * `loadSettings`/`saveSettings` in `main/settings.ts`.
   */
  slashCommands: CustomSlashCommand[]
  /** The OS-wide quick note. App-level on disk, like `hotkeys`. */
  quickNote: QuickNoteSettings
  /** The music folder and player state. App-level on disk, like `hotkeys`. */
  music: MusicSettings
  /** Snippet file name -> enabled. */
  snippets: Record<string, boolean>
  starred: string[]
  /** Show the graph simulation at reduced quality on large vaults. */
  graphPerformanceMode: boolean
  /** Vault-relative path -> icon name, for files/folders the user picked a custom icon for. */
  iconOverrides: Record<string, string>
  /** Vault-relative path -> CSS color, tinting a file/folder's icon in the explorer. */
  colorOverrides: Record<string, string>
  /**
   * Vault-relative path -> vault-relative image path (under `.lumina/icons`), for
   * files/folders the user gave an uploaded image icon. Takes priority over
   * `iconOverrides` when both are set.
   */
  customIcons: Record<string, string>
  /** Files and folders pinned to the top of the file explorer. */
  pinned: string[]
  /** How the file explorer orders siblings. */
  sortOrder: 'name' | 'modified' | 'created'
  /** Show extensions such as `.md` beside note titles in the file explorer. */
  showFileTypes: boolean
  /**
   * How large the file explorer draws its rows, labels and icons.
   *
   * Applied as `--lum-tree-*` tokens in `applyTheme`, not as a class, so the
   * theme editor and user snippets can reach the same dimensions.
   */
  explorerSize: ExplorerSize
  /**
   * Keep a folder's note count visible instead of revealing it on hover.
   */
  alwaysShowFolderCount: boolean
  /**
   * Recording and dictation. App-level on disk, like `hotkeys` — a whisper
   * build and a model live on this machine, not in one vault.
   */
  voice: VoiceSettings
  /** The web clipper's listener. App-level for the same reason. */
  clipper: ClipperSettings
  /** The Home dashboard. The layout itself lives in `.lumina/home.json`. */
  home: HomeSettings
}

export interface HomeSettings {
  /** Show Home when a vault opens with no tabs to restore. */
  openOnLaunch: boolean
}

export type ExplorerSize = 'compact' | 'default' | 'large'

export interface VoiceSettings {
  /**
   * Vault-relative folder recordings are saved into. Separate from
   * `attachmentFolder` so a vault's images and its voice notes can be kept
   * apart, which matters more here — recordings are large.
   */
  folder: string
  /**
   * Transcribe a recording after it is saved, and write the text under the
   * player. Off until a model is actually installed, so the command does not
   * appear to hang on a machine that has none.
   */
  transcribe: boolean
  /** Keep the audio file after transcribing it, rather than only the text. */
  keepAudio: boolean
  /** BCP-47-ish code whisper understands, or `auto` to let it detect. */
  language: string
  /**
   * `MediaDeviceInfo.deviceId` of the chosen microphone; empty means whatever
   * the system default is at the time of recording.
   */
  deviceId: string
  /**
   * Write dictated text into the note as each phrase is finished, rather than
   * all at once when the recording stops. Keeps a whisper process resident
   * while dictating, which is what makes it fast enough to be worth watching.
   */
  liveDictation: boolean
  /**
   * The first-run offer to install a speech pack has been answered.
   *
   * Set whichever way it was answered, so declining is remembered as firmly
   * as accepting — nobody should be asked about speech models twice.
   */
  setupPrompted: boolean
  /** Overrides for the whisper executable and model; empty means auto-detect. */
  binaryPath: string
  modelPath: string
  /** Speaking a selection back, the other direction of the same feature. */
  readAloud: ReadAloudSettings
}

/**
 * Read aloud, which is the only voice feature that needs no model at all — the
 * synthesizer is the operating system's own, reached through the renderer's
 * `speechSynthesis`. Nothing here leaves the machine, and nothing has to be
 * installed first.
 *
 * App-level with the rest of `voice`: which voices exist is a property of this
 * computer, not of a vault.
 */
export interface ReadAloudSettings {
  /**
   * `SpeechSynthesisVoice.voiceURI` of the chosen voice; empty means whatever
   * the system picks for the utterance's language. A URI that no longer
   * resolves (a voice the user uninstalled) falls back the same way.
   */
  voice: string
  /** Speaking rate, 0.5-2. 1 is the voice's own pace. */
  rate: number
  /** Pitch, 0-2. Some platform voices ignore this entirely. */
  pitch: number
  /** Volume, 0-1, independent of the system mixer. */
  volume: number
}

/**
 * The web clipper's listener.
 *
 * App-level on disk, like `voice`: a port and a shared token describe this
 * machine, not one vault. Off by default — this is the only inbound connection
 * Lumina ever accepts, so it opens because the user asked, never by default.
 */
/**
 * The music folder, and how the player was left.
 *
 * App-level on disk, like `hotkeys` and `voice`: a folder of music belongs to
 * this machine, not to a vault, and the player keeps going across a vault
 * switch. Nothing here is ever indexed or watched — see `main/music.ts`.
 */
export interface MusicSettings {
  /** Absolute path to the music folder, or empty for none chosen. */
  folder: string
  /** 0-1. */
  volume: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  /** Music-relative path of the track to restore, never auto-played. */
  lastTrack?: string
  /** Seconds into it. Written on pause, on track change and on quit. */
  lastPosition?: number
}

/** One playable file, as the listing reports it. Paths are music-relative. */
export interface MusicTrack {
  path: string
  size: number
  mtime: number
  /** Artwork found beside it, music-relative. */
  cover?: string
}

/**
 * What `music:list` answers.
 *
 * `ok: false` means the folder could not be read — unplugged drive, absent
 * share, a path that has been deleted. Kept apart from an empty `tracks` so
 * the player can say "that folder cannot be reached" instead of showing what
 * looks like a library with nothing in it.
 */
export interface MusicListing {
  ok: boolean
  /** The folder that was looked in, for the message when it cannot be reached. */
  root: string | null
  tracks: MusicTrack[]
  /** True when the library is larger than the cap and the list stops short. */
  truncated: boolean
}

export interface ClipperSettings {
  enabled: boolean
  port: number
  /** Shared secret the extension must present. Generated, never typed. */
  token: string
  /** Vault-relative folder clips are filed in. */
  folder: string
  /** Tags added to every clip on top of whatever the popup sent. */
  tags: string[]
  /** Copy images into the vault so a clip still reads offline. */
  downloadImages: boolean
  /** Open each clip in a tab as it lands. */
  openOnClip: boolean
}

/** A speech engine or model carried inside the installer. */
export type SpeechPackKind = 'engine' | 'model'

export interface SpeechPack {
  id: string
  kind: SpeechPackKind
  name: string
  /** One line the settings panel shows under the name. */
  description: string
  /** Folder under the bundle, and under `userData` once installed. */
  folder: string
  /** Bytes, from what is actually on disk in this build. */
  size: number
  /** Present in this build. */
  bundled: boolean
  /** Already copied into `userData`. */
  installed: boolean
  /** Needs an NVIDIA GPU to be worth installing. */
  requiresGpu?: boolean
}

/** Progress while a pack is copied, so a gigabyte does not look like a hang. */
export interface SpeechInstallProgress {
  id: string
  copied: number
  total: number
}

/** Whether the clip listener is up, for the settings panel. */
export interface ClipperStatus {
  running: boolean
  port: number
  /** Why it is not running, ready to show as-is. */
  error: string | null
}

/** What the main process found when it went looking for a local speech model. */
export interface VoiceToolStatus {
  available: boolean
  /** Why it is unavailable, ready to show as-is. Null when it is available. */
  reason: string | null
  /** Conventional install folder, so settings can point the user at it. */
  folder: string
  binary: string | null
  model: string | null
}

export interface TranscribeResponse {
  ok: boolean
  text?: string
  error?: string
}

/** The three `--lum-tree-*` sets `explorerSize` chooses between. */
export const EXPLORER_SIZES: Record<ExplorerSize, { row: number; font: number; icon: number; gap: number; indent: number }> = {
  compact: { row: 30, font: 13, icon: 15, gap: 8, indent: 16 },
  default: { row: 36, font: 14.5, icon: 18, gap: 10, indent: 18 },
  large: { row: 42, font: 16, icon: 21, gap: 12, indent: 21 }
}

/* -------------------------------------------------------------- workspace */

export type NoteMode = 'edit' | 'read'

/**
 * What a tab shows. Absent means 'note' rather than being written out, so a
 * `workspace.json` from before Home existed still opens the way it used to.
 */
export type TabKind = 'note' | 'home'

export interface TabState {
  kind?: TabKind
  /** Vault-relative note path, or '' for a home tab, which names no file. */
  path: string
  /** Scroll/cursor position to restore, as a document offset. */
  cursor?: number
  /**
   * Whether this tab shows the editor or the rendered note. Absent means
   * 'edit', so a `workspace.json` written before this existed still opens
   * the way it used to.
   */
  mode?: NoteMode
}

/** True for a tab that shows a real note, which is every tab that omits `kind`. */
export const isNoteTab = (tab: TabState): boolean => (tab.kind ?? 'note') === 'note'

export type LeftPanel = 'files' | 'search' | 'tags' | 'starred'
export type RightPanel = 'backlinks' | 'outline' | 'graph'

export interface WorkspaceState {
  tabs: TabState[]
  activeTab: number
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  leftPanel: LeftPanel
  rightPanel: RightPanel
  /** Expanded folder paths in the file tree. */
  expanded: string[]
  focusMode: boolean
}

/* ----------------------------------------------------------------- search */

export interface SearchHit {
  path: string
  title: string
  score: number
  matches: { line: number; text: string; from: number; to: number }[]
}

export interface SearchOptions {
  /** Match only note titles/filenames, not body content. */
  titleOnly?: boolean
  /** Restrict results to this vault-relative folder (and its subfolders). */
  folder?: string
}

/* --------------------------------------------------------------- fs events */

export type VaultChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface VaultChange {
  type: VaultChangeType
  path: string
}

/* -------------------------------------------------- files opened by the OS */

/**
 * A note the operating system asked Lumina to open — a double-click, an
 * "Open with", or a path on the command line.
 */
export interface FileOpenRequest {
  /** Vault-relative path of the note, valid once its vault is open. */
  path: string
  /**
   * Set when no vault Lumina knows about contains the file, in which case the
   * renderer asks before adopting the folder. Without the question, opening a
   * stray note would silently index wherever it happened to live.
   */
  ask: FileAdoptRequest | null
}

export interface FileAdoptRequest {
  /** Absolute path of the note, handed back to `files.adopt` on confirmation. */
  file: string
  /** Absolute path of the folder that would become the vault. */
  folder: string
  /** Folder name, for the dialog. */
  name: string
}

/* ------------------------------------------------------------------ home */

/**
 * One widget on the Home board.
 *
 * Coordinates are in grid units, not pixels: the board picks a column count
 * from its own width, so a layout authored at four columns still reads at one.
 */
export interface HomeWidget {
  /** Stable across moves and resizes, so React keys and drag state survive. */
  id: string
  /** `WidgetDef.type` from the renderer's registry. */
  type: string
  x: number
  y: number
  w: number
  h: number
  /** Per-widget options, merged over the registry's `defaultConfig` on load. */
  config: Record<string, unknown>
}

/** The picture across the top of the board. */
export interface HomeCover {
  /**
   * Vault-relative image path, under `.lumina/home` — a dot folder, so a cover
   * never shows up as a note. Served over `lumina://` like every other vault
   * image rather than by widening the CSP.
   */
  path: string
  /** Vertical focal point, 0-100, so a tall photo can be nudged into place. */
  position: number
}

export interface HomeLayout {
  version: number
  /** The column count these coordinates were authored against. */
  columns: number
  widgets: HomeWidget[]
  /** Absent means no cover, which is what a board starts with. */
  cover?: HomeCover
}

export const HOME_LAYOUT_VERSION = 1

/* ------------------------------------------------------------------ misc */

export interface WriteResult {
  ok: boolean
  mtime: number
  error?: string
}

export interface OpResult<T = void> {
  ok: boolean
  data?: T
  error?: string
}
