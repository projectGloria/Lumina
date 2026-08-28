/**
 * Operations that span more than one store.
 *
 * Components and the command registry both call in here, so a note gets
 * created the same way whether it came from the sidebar, a broken link, or the
 * command palette.
 */
import { basename, dirname, joinPath, stripExtension } from '@shared/markdown-parse'
import { useEditor } from '../store/editorStore'
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

/** Requested reveal target, picked up by the editor once the note is loaded. */
export let pendingReveal: { path: string; anchor?: string; line?: number } | null = null

export function consumeReveal(path: string): { anchor?: string; line?: number } | null {
  if (!pendingReveal || pendingReveal.path !== path) return null
  const { anchor, line } = pendingReveal
  pendingReveal = null
  return { anchor, line }
}

export function openNote(path: string, opts: OpenOptions = {}): void {
  if (opts.anchor !== undefined || opts.line !== undefined) {
    pendingReveal = { path, anchor: opts.anchor, line: opts.line }
  }
  useWorkspace.getState().openNote(path, opts)
  void useEditor.getState().open(path)
}

/* ------------------------------------------------------------ creating */

/** Create a note and open it. Returns the path actually used. */
export async function createNote(folder = '', title = 'Untitled', content = ''): Promise<string | null> {
  const res = await window.lumina.notes.create(joinPath(folder, `${title}.md`), content)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the note', 'error')
    return null
  }
  openNote(res.data, { newTab: false })
  // Land in the title so the first thing typed names the note.
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
  const isFolder = !path.endsWith('.md')
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
      const target = joinPath(dirname(path), isFolder || next.endsWith('.md') ? next : `${next}.md`)
      const res = await window.lumina.notes.rename(path, target)
      if (!res.ok || !res.data) return res.error ?? 'Could not rename'
      useEditor.getState().rename(path, res.data)
      useWorkspace.getState().renamePathInTabs(path, res.data)
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
  const res = await window.lumina.notes.rename(path, target)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not move', 'error')
    return
  }
  useEditor.getState().rename(path, res.data)
  useWorkspace.getState().renamePathInTabs(path, res.data)
}

/* ------------------------------------------------------------ deleting */

export function confirmDelete(path: string): void {
  const isFolder = !path.endsWith('.md')
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
    }
  })
}

/* -------------------------------------------------------- daily notes */

/** Minimal date formatter covering the tokens the settings field advertises. */
export function formatDate(format: string, date = new Date()): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return format.replace(/YYYY|YY|MMMM|MMM|MM|DDDD|DDD|DD|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY': return String(date.getFullYear())
      case 'YY': return pad(date.getFullYear() % 100)
      case 'MMMM': return months[date.getMonth()]
      case 'MMM': return months[date.getMonth()].slice(0, 3)
      case 'MM': return pad(date.getMonth() + 1)
      case 'DDDD': return days[date.getDay()]
      case 'DDD': return days[date.getDay()].slice(0, 3)
      case 'DD': return pad(date.getDate())
      case 'HH': return pad(date.getHours())
      case 'mm': return pad(date.getMinutes())
      case 'ss': return pad(date.getSeconds())
      default: return token
    }
  })
}

/** Fill `{{date}}`, `{{time}}` and `{{title}}` in a template body. */
export function applyTemplate(body: string, title: string): string {
  return body
    .replace(/\{\{\s*title\s*\}\}/g, title)
    .replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/g, (_m, fmt) => formatDate(fmt || 'YYYY-MM-DD'))
    .replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/g, (_m, fmt) => formatDate(fmt || 'HH:mm'))
}

export async function openDailyNote(): Promise<void> {
  const { dailyNotes } = useSettings.getState().settings
  const name = formatDate(dailyNotes.format || 'YYYY-MM-DD')
  const path = joinPath(dailyNotes.folder, `${name}.md`)

  if (await window.lumina.notes.exists(path)) {
    openNote(path)
    return
  }

  let body = `# ${name}\n\n`
  if (dailyNotes.template) {
    const tpl = await window.lumina.notes.read(dailyNotes.template)
    if (tpl.ok && tpl.data) body = applyTemplate(tpl.data.content, name)
  }

  const res = await window.lumina.notes.create(path, body)
  if (!res.ok || !res.data) {
    toast(res.error ?? 'Could not create the daily note', 'error')
    return
  }
  openNote(res.data)
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

/* --------------------------------------------------------------- vault */

export async function pickVault(): Promise<void> {
  useVault.getState().setLoading(true)
  const payload = await window.lumina.vault.pick()
  if (!payload) useVault.getState().setLoading(false)
}

export async function openVaultPath(dir: string): Promise<void> {
  useVault.getState().setLoading(true)
  const payload = await window.lumina.vault.open(dir)
  if (!payload) {
    useVault.getState().setLoading(false)
    toast('That folder is no longer there', 'error')
  }
}
