/**
 * Operations that span more than one store.
 *
 * Components and the command registry both call in here, so a note gets
 * created the same way whether it came from the sidebar, a broken link, or the
 * command palette.
 */
import { HOME_COVER_DIR } from '@shared/homeCovers'
import type { WidgetPathHooks } from '@shared/homePaths'
import { isNoteTab } from '@shared/types'
import {
  basename,
  dirname,
  isMarkdownPath,
  isPathAtOrBelow,
  joinPath,
  rebaseDescendantPath,
  stripExtension
} from '@shared/markdown-parse'
import { DEFAULT_QUICK_NOTE_FOLDER, isGeneratedNoteName, quickNoteName } from '@shared/quickNote'
import { applyTemplate, formatDate } from '@shared/template'
import { useEditor } from '../store/editorStore'
import { useHome } from '../store/homeStore'
import { useSettings } from '../store/settingsStore'
import { toast, useUi } from '../store/uiStore'
import { pathForNewNote, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

export interface OpenOptions {
  newTab?: boolean
  replace?: boolean
  /** Scroll to this heading after opening. */
  anchor?: string
  /** Scroll to this zero-based line after opening. */
  line?: number
}

export function openNote(path: string, opts: OpenOptions = {}): void {
  if (opts.anchor !== undefined || opts.line !== undefined) {
    // Held in the ui store rather than a module variable so the editor can
    // react to it. A note that is already the active tab does not remount, so
    // a reveal read only on mount would be dropped — which is what made
    // clicking a search hit inside the open note do nothing at all.
    useUi.getState().requestReveal({ path, anchor: opts.anchor, line: opts.line })
  }
  // History navigation can still replace a tab. Diffing the strip rather than
  // re-deriving which path was displaced keeps buffer cleanup correct for
  // append, activate, replace and explicit duplicate opens.
  const before = useWorkspace.getState().tabs.filter(isNoteTab).map((tab) => tab.path)
  useWorkspace.getState().openNote(path, opts)
  void useEditor.getState().open(path)

  const after = new Set(useWorkspace.getState().tabs.filter(isNoteTab).map((tab) => tab.path))
  for (const displaced of before) {
    if (!after.has(displaced)) void releaseNote(displaced)
  }
}

/** Save one note and replay the unobtrusive manual-save confirmation. */
export async function saveNoteWithFeedback(path: string): Promise<void> {
  const before = useEditor.getState().buffers[path]
  if (!before || before.loading) return

  await useEditor.getState().save(path)
  const after = useEditor.getState().buffers[path]
  // A failed write remains dirty and already produces an error toast.
  if (after && !after.loading && after.content === after.saved) {
    useUi.getState().showSaveIndicator()
  }
}

/* -------------------------------------------------------------- tabs */

/**
 * Close a tab and let go of the note behind it.
 *
 * `workspaceStore` only knows about tabs, so closing one used to leave the
 * buffer — the whole text of the note — in memory for the rest of the session.
 * Releasing it has to wait for the debounced autosave, or closing a tab
 * seconds after typing would drop those keystrokes on the floor.
 */
export async function closeTab(index: number): Promise<void> {
  const tab = useWorkspace.getState().tabs[index]
  useWorkspace.getState().closeTab(index)
  // Home holds no buffer, so there is nothing behind it to release.
  if (tab && isNoteTab(tab) && tab.path) await releaseNote(tab.path)
}

/** Close every tab but one, releasing the notes that are no longer open. */
export async function closeOtherTabs(index: number): Promise<void> {
  const before = useWorkspace.getState().tabs.filter(isNoteTab).map((tab) => tab.path)
  useWorkspace.getState().closeOthers(index)
  await Promise.all(before.map((path) => releaseNote(path)))
}

/**
 * Buffers something other than a tab is keeping open.
 *
 * A tab is not the only reason a note has to stay loaded: the Home board's
 * scratch pad edits one for as long as its card is on screen, and
 * `updateNoteContent` needs one for the length of a write. Without this,
 * `releaseNote` closed any buffer no *tab* held — so ticking a task that lives
 * in the scratch note closed the pad's buffer out from under it, leaving a
 * blank disabled box until the widget was remounted.
 *
 * Counted rather than flagged, because holders come and go independently and
 * only the last one out should let the buffer close.
 */
const holds = new Map<string, number>()

/** Keep `path`'s buffer open until the matching `dropNote`. */
export function holdNote(path: string): void {
  holds.set(path, (holds.get(path) ?? 0) + 1)
}

/** Give up one hold on `path`. Does not itself close anything. */
export function dropNote(path: string): void {
  const left = (holds.get(path) ?? 0) - 1
  if (left > 0) holds.set(path, left)
  else holds.delete(path)
}

/** Whether anything still needs this buffer: a tab, or a holder. */
function wanted(path: string): boolean {
  if ((holds.get(path) ?? 0) > 0) return true
  return useWorkspace.getState().tabs.some((tab) => tab.path === path)
}

/**
 * Drop a note's buffer once nothing shows it any more.
 *
 * The same note can sit in two tabs, so the check is against what is left
 * rather than against the tab that just went away — and it is made again after
 * the save, because a tab can open or a widget mount while the write is in
 * flight.
 */
export async function releaseNote(path: string): Promise<void> {
  if (wanted(path)) return
  await useEditor.getState().save(path)
  if (wanted(path)) return
  useEditor.getState().close(path)
}

/* ------------------------------------------------------------ creating */

/** Create a note and open it. Returns the path actually used. */
export async function createNote(folder = '', title = 'Untitled', content = ''): Promise<string | null> {
  const res = await window.lumina.notes.create(joinPath(folder, `${title}.md`), content)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the note', 'error')
    return null
  }
  openNote(res.data)
  // Land in the title so the first thing typed names the note.
  return res.data
}

/** Create a note at `path` if it is not there yet, without opening a tab. */
export async function ensureNote(path: string, content = ''): Promise<string | null> {
  if (await window.lumina.notes.exists(path)) return path
  const res = await window.lumina.notes.create(path, content)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the note', 'error')
    return null
  }
  return res.data
}

/** Create the note an unresolved `[[link]]` points at, then open it. */
export async function createFromLink(target: string, fromPath: string | null): Promise<void> {
  const path = pathForNewNote(target, fromPath)
  const exists = await window.lumina.notes.exists(path)
  if (exists) {
    openNote(path)
    return
  }
  const res = await window.lumina.notes.create(path, `# ${stripExtension(basename(path))}\n\n`)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the note', 'error')
    return
  }
  openNote(res.data)
}

/* --------------------------------------------------------- quick notes */

/**
 * Presses of the OS-wide shortcut that arrived before there was a vault to
 * write into — during the profile picker, or behind a passlock. The main
 * process has already done its own queueing across the window's cold start;
 * this covers the part of the journey after the renderer is up but before a
 * vault is open.
 */
let pendingQuickNotes = 0

export function requestQuickNote(): void {
  pendingQuickNotes++
  void drainQuickNotes()
}

/** Called again once a vault opens, so a note asked for at the lock screen still lands. */
export async function drainQuickNotes(): Promise<void> {
  if (!useVault.getState().vault) return
  while (pendingQuickNotes > 0) {
    pendingQuickNotes--
    await createQuickNote()
  }
}

/**
 * Find an open timestamp-generated note that is still truly empty.
 * Named empty notes are deliberately ignored: an empty project note may be a
 * placeholder the user intends to keep, whereas the timestamp proves this one
 * came from the quick-create flow.
 */
async function reusableGeneratedNote(folder: string): Promise<string | null> {
  const { tabs, activeTab } = useWorkspace.getState()
  const active = tabs[activeTab]
  const ordered = [active, ...[...tabs].reverse()].filter(
    (tab, index, all): tab is NonNullable<typeof tab> =>
      !!tab && all.findIndex((candidate) => candidate?.path === tab.path) === index
  )
  const targetFolder = dirname(joinPath(folder, 'placeholder.md'))

  for (const tab of ordered) {
    if (dirname(tab.path) !== targetFolder) continue
    if (!isGeneratedNoteName(stripExtension(basename(tab.path)))) continue

    const buffer = useEditor.getState().buffers[tab.path]
    if (buffer && !buffer.loading) {
      if (buffer.content === '') return tab.path
      continue
    }

    const disk = await window.lumina.notes.read(tab.path)
    if (disk.ok && disk.data?.content === '') return tab.path
  }
  return null
}

// Ctrl+N can repeat before its first async create finishes. Serializing the
// check-and-create pair makes the second call see and reuse the first note.
let generatedNoteChain: Promise<void> = Promise.resolve()

/** File a timestamp-named note, without opening it. */
async function newGeneratedNote(folder: string, content = ''): Promise<string | null> {
  const res = await window.lumina.notes.create(joinPath(folder, `${quickNoteName()}.md`), content)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the note', 'error')
    return null
  }
  return res.data
}

async function createOrReuseGeneratedNote(folder: string): Promise<string | null> {
  const reusable = await reusableGeneratedNote(folder)
  if (reusable) {
    openNote(reusable)
    return reusable
  }

  const path = await newGeneratedNote(folder)
  if (path) openNote(path, { newTab: true })
  return path
}

/** Create a timestamped blank note, unless an open generated one is still blank. */
export function createGeneratedNote(folder = ''): Promise<string | null> {
  const operation = generatedNoteChain.then(() => createOrReuseGeneratedNote(folder))
  generatedNoteChain = operation.then(
    () => undefined,
    () => undefined
  )
  return operation
}

/** Where quick notes are filed, falling back when the setting is blank. */
export function quickNoteFolder(): string {
  return useSettings.getState().settings.quickNote.folder || DEFAULT_QUICK_NOTE_FOLDER
}

/** The OS-wide quick note uses the configured folder and the shared reuse rules. */
export function createQuickNote(): Promise<string | null> {
  return createGeneratedNote(quickNoteFolder())
}

/**
 * File a captured line without leaving what you were doing.
 *
 * Home's capture widget is the only caller so far, and it deliberately does
 * not open what it writes — the point of capturing from a dashboard is that
 * the dashboard is still in front of you afterwards.
 */
export async function captureText(
  text: string,
  target: 'quick' | 'daily' = 'quick'
): Promise<boolean> {
  const body = text.trim()
  if (!body) return false

  if (target === 'daily') {
    const path = await ensureDailyNote()
    if (!path) return false
    return updateNoteContent(path, (content) => `${content.trimEnd()}\n\n${body}\n`)
  }

  return !!(await newGeneratedNote(quickNoteFolder(), `${body}\n`))
}

/**
 * Change a note's text through the same buffer the editor writes.
 *
 * Writing the file directly would come back through the watcher as an
 * external edit — reloaded over a clean buffer, refused on a dirty one — so
 * anything that edits a note the user may also have open goes through the
 * store instead. The buffer is released again unless a tab is holding it, so
 * a board full of widgets does not end up carrying half the vault in memory.
 */
export async function updateNoteContent(
  path: string,
  edit: (content: string) => string
): Promise<boolean> {
  // Held for the length of the write. A tab closing or a widget unmounting
  // part way through must not close the buffer being written through, and two
  // of these running on one note must not close it under each other.
  holdNote(path)
  try {
    await useEditor.getState().open(path)
    const buffer = useEditor.getState().buffers[path]
    if (!buffer || buffer.loading || buffer.error) {
      toast(buffer?.error ?? `Could not read ${basename(path)}`, 'error')
      return false
    }

    useEditor.getState().setContent(path, edit(buffer.content))
    await useEditor.getState().save(path)
    return true
  } finally {
    // The hold goes first, or the release below finds the note still held.
    dropNote(path)
    await releaseNote(path)
  }
}

export function promptNewNote(folder = ''): void {
  useUi.getState().showPrompt({
    title: folder ? `New note in ${folder}` : 'New note',
    label: 'Name',
    initial: 'Untitled',
    confirmLabel: 'Create',
    onSubmit: async (value) => {
      const name = value.trim()
      if (!name) return 'Give the note a name'
      await createNote(folder, name)
    }
  })
}

export function promptNewFolder(parent = ''): void {
  useUi.getState().showPrompt({
    title: parent ? `New folder in ${parent}` : 'New folder',
    label: 'Name',
    initial: 'New folder',
    confirmLabel: 'Create',
    onSubmit: async (value) => {
      const name = value.trim()
      if (!name) return 'Give the folder a name'
      const res = await window.lumina.notes.createFolder(joinPath(parent, name))
      if (!res.ok) return res.error ?? 'Could not create the folder'
      if (res.data) useWorkspace.getState().toggleExpanded(res.data)
    }
  })
}

/* ------------------------------------------------------------ renaming */

export function promptRename(path: string): void {
  const isFolder = !isMarkdownPath(path)
  const name = basename(path)
  useUi.getState().showPrompt({
    title: isFolder ? 'Rename folder' : 'Rename note',
    label: 'Name',
    initial: name,
    confirmLabel: 'Rename',
    selectLength: isFolder ? name.length : stripExtension(name).length,
    onSubmit: async (value) => {
      const next = value.trim()
      if (!next) return 'Give it a name'
      if (next === name) return
      await useEditor.getState().saveAll()
      const target = joinPath(dirname(path), isFolder || isMarkdownPath(next) ? next : `${next}.md`)
      const res = await window.lumina.notes.rename(path, target)
      if (!res.ok || !res.data) return res.error ?? 'Could not rename'
      useEditor.getState().rename(path, res.data)
      useWorkspace.getState().renamePathInTabs(path, res.data)
      renameStarredPaths(path, res.data)
      renameIconOverrides(path, res.data)
      renameColorOverrides(path, res.data)
      renameCustomIcons(path, res.data)
      renamePinnedPaths(path, res.data)
      renameWidgetPaths(path, res.data)
    }
  })
}

/** Move a note or folder into another folder, used by tree drag and drop. */
export async function movePath(path: string, targetFolder: string): Promise<void> {
  const target = joinPath(targetFolder, basename(path))
  if (target === path) return
  if (targetFolder === path || targetFolder.startsWith(`${path}/`)) {
    toast('A folder cannot be moved inside itself', 'error')
    return
  }
  await useEditor.getState().saveAll()
  const res = await window.lumina.notes.rename(path, target)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not move', 'error')
    return
  }
  useEditor.getState().rename(path, res.data)
  useWorkspace.getState().renamePathInTabs(path, res.data)
  renameStarredPaths(path, res.data)
  renameIconOverrides(path, res.data)
  renameColorOverrides(path, res.data)
  renameCustomIcons(path, res.data)
  renamePinnedPaths(path, res.data)
  renameWidgetPaths(path, res.data)
}

/* ------------------------------------------------------------ deleting */

export function confirmDelete(path: string): void {
  const isFolder = !isMarkdownPath(path)
  useUi.getState().showConfirm({
    title: `Delete ${isFolder ? 'folder' : 'note'}?`,
    body: `"${basename(path)}" goes to the recycle bin. You can restore it from there.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      const res = await window.lumina.notes.remove(path)
      if (!res.ok) {
        toast(res.error ?? 'Could not delete', 'error')
        return
      }
      useEditor.getState().close(path)
      useWorkspace.getState().removePathFromTabs(path)
      removeStarredPaths(path)
      removeIconOverrides(path)
      removeColorOverrides(path)
      removeCustomIcons(path)
      removePinnedPaths(path)
      removeWidgetPaths(path)
    }
  })
}

/* -------------------------------------------------------- daily notes */

// Both moved to `@shared/template` so the slash-command snippets can share the
// same placeholder vocabulary and be tested without a DOM. Re-exported here
// because this is where callers have always found them.
export { applyTemplate, formatDate }

/** Where a day's note lives, whether or not it has been written yet. */
export function dailyNotePath(day = new Date()): string {
  const { dailyNotes } = useSettings.getState().settings
  return joinPath(dailyNotes.folder, `${formatDate(dailyNotes.format || 'YYYY-MM-DD', day)}.md`)
}

/**
 * Today's daily note, created from the template if it is not there yet.
 *
 * Split out of `openDailyNote` so Home's daily widget can offer today's note
 * without the command's side effect of opening a tab.
 */
export async function ensureDailyNote(): Promise<string | null> {
  const { dailyNotes } = useSettings.getState().settings
  const name = formatDate(dailyNotes.format || 'YYYY-MM-DD')
  const path = dailyNotePath()

  if (await window.lumina.notes.exists(path)) return path

  let body = `# ${name}\n\n`
  if (dailyNotes.template) {
    const tpl = await window.lumina.notes.read(dailyNotes.template)
    if (tpl.ok && tpl.data) body = applyTemplate(tpl.data.content, name)
  }

  const res = await window.lumina.notes.create(path, body)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the daily note', 'error')
    return null
  }
  return res.data
}

export async function openDailyNote(): Promise<void> {
  const path = await ensureDailyNote()
  if (path) openNote(path)
}

/* ------------------------------------------------------------- starring */

export function toggleStar(path: string): void {
  const { settings, patch } = useSettings.getState()
  const starred = settings.starred.includes(path)
    ? settings.starred.filter((p) => p !== path)
    : [...settings.starred, path]
  patch({ starred })
}

export function isStarred(path: string): boolean {
  return useSettings.getState().settings.starred.includes(path)
}

export function renameStarredPaths(from: string, to: string): void {
  const { settings, patch } = useSettings.getState()
  const starred = settings.starred.map((path) => rebaseDescendantPath(path, from, to))
  if (starred.some((path, i) => path !== settings.starred[i])) patch({ starred })
}

export function removeStarredPaths(parent: string): void {
  const { settings, patch } = useSettings.getState()
  const starred = settings.starred.filter((path) => !isPathAtOrBelow(path, parent))
  if (starred.length !== settings.starred.length) patch({ starred })
}

/* --------------------------------------------------------------- pinning */

export function togglePin(path: string): void {
  const { settings, patch } = useSettings.getState()
  const pinned = settings.pinned.includes(path)
    ? settings.pinned.filter((p) => p !== path)
    : [...settings.pinned, path]
  patch({ pinned })
}

export function isPinned(path: string): boolean {
  return useSettings.getState().settings.pinned.includes(path)
}

export function renamePinnedPaths(from: string, to: string): void {
  const { settings, patch } = useSettings.getState()
  const pinned = settings.pinned.map((path) => rebaseDescendantPath(path, from, to))
  if (pinned.some((path, i) => path !== settings.pinned[i])) patch({ pinned })
}

export function removePinnedPaths(parent: string): void {
  const { settings, patch } = useSettings.getState()
  const pinned = settings.pinned.filter((path) => !isPathAtOrBelow(path, parent))
  if (pinned.length !== settings.pinned.length) patch({ pinned })
}

/* -------------------------------------------------------- icon overrides */

export function setIconOverride(path: string, icon: string | null): void {
  const { settings, patch } = useSettings.getState()
  const iconOverrides = { ...settings.iconOverrides }
  if (icon) iconOverrides[path] = icon
  else delete iconOverrides[path]
  patch({ iconOverrides })
}

export function renameIconOverrides(from: string, to: string): void {
  const { settings, patch } = useSettings.getState()
  const entries = Object.entries(settings.iconOverrides).map(
    ([path, icon]) => [rebaseDescendantPath(path, from, to), icon] as const
  )
  const iconOverrides = Object.fromEntries(entries)
  patch({ iconOverrides })
}

export function removeIconOverrides(parent: string): void {
  const { settings, patch } = useSettings.getState()
  const entries = Object.entries(settings.iconOverrides).filter(
    ([path]) => !isPathAtOrBelow(path, parent)
  )
  if (entries.length !== Object.keys(settings.iconOverrides).length) {
    patch({ iconOverrides: Object.fromEntries(entries) })
  }
}

/* ------------------------------------------------------- color overrides */

export function setColorOverride(path: string, color: string | null): void {
  const { settings, patch } = useSettings.getState()
  const colorOverrides = { ...settings.colorOverrides }
  if (color) colorOverrides[path] = color
  else delete colorOverrides[path]
  patch({ colorOverrides })
}

export function renameColorOverrides(from: string, to: string): void {
  const { settings, patch } = useSettings.getState()
  const entries = Object.entries(settings.colorOverrides).map(
    ([path, color]) => [rebaseDescendantPath(path, from, to), color] as const
  )
  patch({ colorOverrides: Object.fromEntries(entries) })
}

export function removeColorOverrides(parent: string): void {
  const { settings, patch } = useSettings.getState()
  const entries = Object.entries(settings.colorOverrides).filter(
    ([path]) => !isPathAtOrBelow(path, parent)
  )
  if (entries.length !== Object.keys(settings.colorOverrides).length) {
    patch({ colorOverrides: Object.fromEntries(entries) })
  }
}

/* -------------------------------------------------------- custom icons */

/* ------------------------------------------------- the Home board's paths */

/**
 * How the two walkers below find a widget's path hooks.
 *
 * Registered by the widget registry rather than imported from it, for the same
 * reason `useHome.load` takes its seed as a parameter: this file sits at the
 * bottom of the renderer's import graph — it imports only shared code and
 * stores, and everything else imports it — and reaching for the registry here
 * would make that a cycle, since every widget imports this file. The registry
 * publishes itself on the way up instead.
 */
let widgetPathHooks: (type: string) => WidgetPathHooks | undefined = () => undefined

export function registerWidgetPathHooks(lookup: (type: string) => WidgetPathHooks | undefined): void {
  widgetPathHooks = lookup
}

/**
 * Ask every widget on the board to update the vault paths it stores.
 *
 * `home.json` holds paths — a scratch pad's note, a task list's folder — so a
 * board is one more thing a rename has to move, alongside buffers, tabs and
 * the path-keyed settings maps. Which of its options are paths is the widget's
 * own business, declared as `rebasePaths` / `forgetPaths` on its definition,
 * so a widget added later is covered by having said so rather than by someone
 * remembering to come back here.
 *
 * `patch` returning null for every widget writes nothing at all, which is what
 * keeps a rename elsewhere in the vault from touching the board.
 */
function walkWidgetPaths(
  patch: (hooks: WidgetPathHooks, config: Record<string, unknown>) => Record<string, unknown> | null
): void {
  const { layout, setWidgetConfig } = useHome.getState()
  for (const widget of layout.widgets) {
    const hooks = widgetPathHooks(widget.type)
    if (!hooks) continue
    const change = patch(hooks, widget.config)
    if (change) setWidgetConfig(widget.id, change)
  }
}

export function renameWidgetPaths(from: string, to: string): void {
  walkWidgetPaths((hooks, config) => hooks.rebasePaths?.(config, from, to) ?? null)
}

export function removeWidgetPaths(deleted: string): void {
  walkWidgetPaths((hooks, config) => hooks.forgetPaths?.(config, deleted) ?? null)
}

/** Vault-relative folder uploaded icon images are copied into. */
const CUSTOM_ICON_FOLDER = '.lumina/icons'

export function setCustomIcon(path: string, iconPath: string | null): void {
  const { settings, patch } = useSettings.getState()
  const customIcons = { ...settings.customIcons }
  if (iconPath) customIcons[path] = iconPath
  else delete customIcons[path]
  patch({ customIcons })
}

export function renameCustomIcons(from: string, to: string): void {
  const { settings, patch } = useSettings.getState()
  const entries = Object.entries(settings.customIcons).map(
    ([path, icon]) => [rebaseDescendantPath(path, from, to), icon] as const
  )
  patch({ customIcons: Object.fromEntries(entries) })
}

export function removeCustomIcons(parent: string): void {
  const { settings, patch } = useSettings.getState()
  const entries = Object.entries(settings.customIcons).filter(
    ([path]) => !isPathAtOrBelow(path, parent)
  )
  if (entries.length !== Object.keys(settings.customIcons).length) {
    patch({ customIcons: Object.fromEntries(entries) })
  }
}


/**
 * Pick a picture for the top of the Home board and copy it into the vault.
 *
 * Copied rather than linked, for the same reason clipped images are: a board
 * that points at a file somewhere else on this machine stops working the
 * moment the vault is opened anywhere else. Resolves the vault-relative path,
 * or null when the user cancelled or the copy failed.
 */
export async function pickHomeCover(): Promise<string | null> {
  const file = await pickImageFile()
  if (!file) return null

  const res = await window.lumina.files.saveAttachment(
    HOME_COVER_DIR,
    file.name,
    await file.arrayBuffer()
  )
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not save the picture', 'error')
    return null
  }
  return res.data
}

/** One image from the OS file picker, or null if the dialog was dismissed. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    // `cancel` fires on dismissal in Chromium; without it the promise from a
    // dialog the user closed would never settle.
    input.oncancel = () => resolve(null)
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

/**
 * Opens the OS file picker, copies the chosen image into the vault's hidden
 * icon folder, and sets it as `path`'s custom icon. `.lumina/icons` is
 * ignored by the tree and indexer like every other dot-folder, so the
 * uploaded image never shows up as a note.
 */
export function uploadCustomIcon(path: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    void (async () => {
      const buffer = await file.arrayBuffer()
      const res = await window.lumina.files.saveAttachment(CUSTOM_ICON_FOLDER, file.name, buffer)
      if (!res.ok || !res.data) {
        toast(res.error ?? 'Could not save the icon', 'error')
        return
      }
      setCustomIcon(path, res.data)
    })()
  }
  input.click()
}

/* --------------------------------------------------------------- vault */

export async function pickVault(): Promise<void> {
  useVault.getState().setLoading(true)
  try {
    const payload = await window.lumina.vault.pick()
    if (!payload) useVault.getState().setLoading(false)
  } catch (err) {
    useVault.getState().setLoading(false)
    toast(`Could not open the vault: ${(err as Error).message}`, 'error')
  }
}

export async function openVaultPath(dir: string): Promise<void> {
  useVault.getState().setLoading(true)
  try {
    const payload = await window.lumina.vault.open(dir)
    if (payload) return
    useVault.getState().setLoading(false)
    toast('That folder is no longer there', 'error')
  } catch (err) {
    useVault.getState().setLoading(false)
    toast(`Could not open the vault: ${(err as Error).message}`, 'error')
  }
}
