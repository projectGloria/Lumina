/** Types shared across the main process, preload bridge and renderer. */

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
}

export interface DailyNoteSettings {
  folder: string
  /** `YYYY-MM-DD` style tokens. */
  format: string
  /** Vault-relative template path, or '' for none. */
  template: string
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
  /** Snippet file name -> enabled. */
  snippets: Record<string, boolean>
  starred: string[]
  /** Show the graph simulation at reduced quality on large vaults. */
  graphPerformanceMode: boolean
  /** Vault-relative path -> icon name, for files/folders the user picked a custom icon for. */
  iconOverrides: Record<string, string>
  /** Files and folders pinned to the top of the file explorer. */
  pinned: string[]
  /** How the file explorer orders siblings. */
  sortOrder: 'name' | 'modified' | 'created'
}

/* -------------------------------------------------------------- workspace */

export interface TabState {
  path: string
  /** Scroll/cursor position to restore, as a document offset. */
  cursor?: number
}

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
