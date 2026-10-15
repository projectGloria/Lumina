import type { Encoding, Eol } from './textFiles'

/**
 * One tab.
 *
 * Originally this was only ever a scratch draft — a UUID, some text, and a
 * cursor — and the file-backed fields below are all optional so that a cache
 * written by that version still parses. A draft with no `filePath` is exactly
 * what it always was; one with a `filePath` is a file on disk, and then
 * `savedText` is what that file last contained, which is the only honest way to
 * answer "is this modified".
 *
 * `text` is always LF-normalised — see `toEditorText` — because that is what a
 * `<textarea>` reports whatever it was given. `eol` and `bom` remember what the
 * file actually uses so writing it back does not quietly convert it.
 */
export interface Draft {
  id: string
  createdAt: number
  updatedAt: number
  text: string
  cursor: number
  /** Absolute path once this buffer is a file; absent for a scratch draft. */
  filePath?: string | null
  /** Contents as last read from or written to disk, for the dirty check. */
  savedText?: string | null
  /** Line ending the file uses on disk. Defaults to LF for a new draft. */
  eol?: Eol
  /** The file's encoding, preserved across a save. */
  encoding?: Encoding
  /** Whether the file carries a byte-order mark. */
  bom?: boolean
}

export interface Session {
  version: 1
  buffers: Draft[]
}

/** True when the buffer holds something the user would lose by closing it. */
export function isDirty(draft: Draft): boolean {
  // A file is modified when it no longer matches disk. A scratch draft has no
  // disk state, so anything typed into it counts.
  if (draft.filePath) return draft.text !== (draft.savedText ?? '')
  return draft.text.length > 0
}

/** What a tab calls itself: the file's name, or an untitled placeholder. */
export function draftTitle(draft: Draft, index: number): string {
  if (!draft.filePath) return `new ${index + 1}`
  const normalized = draft.filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || draft.filePath
}

const EOLS = new Set(['lf', 'crlf'])
const ENCODINGS = new Set(['utf8', 'utf16le', 'utf16be'])

export function parseSession(value: unknown): Session {
  const s = value as Session
  if (!s || s.version !== 1 || !Array.isArray(s.buffers)) throw new Error('Invalid session cache')
  const ids = new Set<string>()
  for (const b of s.buffers) {
    if (!b || typeof b.id !== 'string' || ids.has(b.id) || typeof b.text !== 'string' ||
      !Number.isFinite(b.createdAt) || !Number.isFinite(b.updatedAt) ||
      !Number.isInteger(b.cursor) || b.cursor < 0 || b.cursor > b.text.length) throw new Error('Invalid draft')
    // The file-backed fields are optional, but a present one that is the wrong
    // shape means the cache is not what it claims and is not worth guessing at.
    if (b.filePath !== undefined && b.filePath !== null && typeof b.filePath !== 'string') {
      throw new Error('Invalid draft')
    }
    if (b.savedText !== undefined && b.savedText !== null && typeof b.savedText !== 'string') {
      throw new Error('Invalid draft')
    }
    if (b.eol !== undefined && !EOLS.has(b.eol)) throw new Error('Invalid draft')
    if (b.encoding !== undefined && !ENCODINGS.has(b.encoding)) throw new Error('Invalid draft')
    if (b.bom !== undefined && typeof b.bom !== 'boolean') throw new Error('Invalid draft')
    ids.add(b.id)
  }
  return s
}

/** A file read off disk, ready to become a tab. */
export interface FileDocument {
  /** Absolute path, as the OS spells it. */
  path: string
  /** Contents, LF-normalised for the editor. */
  text: string
  eol: Eol
  encoding: Encoding
  bom: boolean
}

/** Opening one file either produced a document or a reason it did not. */
export type FileOpenResult =
  | { ok: true; doc: FileDocument }
  | { ok: false; path: string; error: string }

/** Writing one produced a path, a cancellation, or a reason it did not. */
export interface FileSaveResult {
  ok: boolean
  /** Where it landed. Present only when `ok`. */
  path?: string
  /** True when the user dismissed the Save As dialog; not an error. */
  cancelled?: boolean
  error?: string
}

export interface QuickApi {
  load(): Promise<Session>
  persist(session: Session): Promise<void>
  persistChanges?(buffers: Draft[], order: string[]): Promise<void>
  /** Write a file-backed draft to its own path. Fails if it has none. */
  saveFile(draft: Draft): Promise<FileSaveResult>
  /** Ask where to put it, then write it. Used for scratch drafts and Save As. */
  saveAs(draft: Draft): Promise<FileSaveResult>
  close(): void
  onFlush(callback: (token: number) => void): void
  flushed(token: number, error?: string): void
  /** Native open dialog, then read whatever was chosen. */
  openDialog(): Promise<FileOpenResult[]>
  /** Read specific paths — a reload, or a file dropped on the window. */
  openPaths(paths: string[]): Promise<FileOpenResult[]>
  /** Files the OS handed us before the renderer was listening. Call once, on mount. */
  takePendingFiles(): Promise<FileOpenResult[]>
  /** A file arrived while we were already running (second instance, or macOS). */
  onOpenFiles(callback: (results: FileOpenResult[]) => void): void
  /** The path behind a dropped `File`, which the renderer cannot read itself. */
  pathForFile(file: File): string
  exportSettings?(content: string): Promise<boolean>
  importSettings?(): Promise<string | null>
  getFonts?(): Promise<string[]>
  createDesktopShortcut?(): Promise<{ ok: boolean; path?: string; error?: string }>
  onNew?(callback: () => void): void
}
