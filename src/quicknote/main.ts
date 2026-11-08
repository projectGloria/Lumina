import './style.css'
import { marked } from 'marked'
import type { Draft, FileDocument, FileOpenResult, FileSaveResult, QuickApi, Session } from '../shared/quicknoteSession'
import { draftTitle, isDirty } from '../shared/quicknoteSession'
import { baseName, encodingLabel, eolLabel, type Eol } from '../shared/textFiles'
import { QUICKNOTE_NAME } from '../shared/appNames'

// Window and title-bar suffix; one const so the four call sites can't drift.
const TITLE_SUFFIX = ` - ${QUICKNOTE_NAME}`
import { initTheme, buildThemeEditorModal } from './themeManager'
import { initShortcuts, getShortcuts, matchesShortcut, buildShortcutModal } from './shortcutManager'
import { FindReplaceController } from './findReplace'
import { buildSettingsModal } from './settingsManager'

declare global {
  interface Window {
    quicknote: QuickApi
  }
}

const api = window.quicknote
const editor = document.querySelector<HTMLTextAreaElement>('#editor')!
const tabs = document.querySelector<HTMLDivElement>('#drafts')!
const status = document.querySelector<HTMLElement>('#status')!
const modalContainer = document.querySelector<HTMLDivElement>('#modal-container')!
const readModeBtn = document.querySelector<HTMLButtonElement>('#read-mode-btn')!
const readerWrap = document.querySelector<HTMLDivElement>('#reader-wrap')!
const reader = document.querySelector<HTMLElement>('#reader')!
const gutter = document.querySelector<HTMLElement>('#gutter')!
const editorWrap = document.querySelector<HTMLElement>('#editor-wrap')!

let readMode = false
let session: Session = { version: 1, buffers: [] }
let active: Draft
let loaded = false
let busy = false
let timer: ReturnType<typeof setTimeout>
let writes = Promise.resolve()
let saving: Promise<void> | undefined

/**
 * What a brand-new note is written with.
 *
 * A file that came off disk keeps its own ending — that is the whole point of
 * `Draft.eol` — but a draft that has never been saved has to pick one, and on
 * Windows picking LF would produce files that look like a single line in
 * Notepad. An opened file is never affected by this.
 */
const DEFAULT_EOL: Eol = /Windows/i.test(navigator.userAgent) ? 'crlf' : 'lf'

// Initialize subsystems
initTheme()
initShortcuts()

type Edit = { start: number; removed: string; inserted: string; cursor: number }
const histories = new WeakMap<Draft, { undo: Edit[]; redo: Edit[] }>()
function history(draft: Draft) {
  let value = histories.get(draft)
  if (!value) { value = { undo: [], redo: [] }; histories.set(draft, value) }
  return value
}
function recordEdit(before: string, after: string): void {
  if (before === after) return
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let endA = before.length, endB = after.length
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) { endA--; endB-- }
  const h = history(active)
  h.undo.push({ start, removed: before.slice(start, endA), inserted: after.slice(start, endB), cursor: active.cursor })
  h.redo = []
  let bytes = h.undo.reduce((sum, edit) => sum + edit.removed.length + edit.inserted.length, 0)
  while (h.undo.length > 200 || (bytes > 8 * 1024 * 1024 && h.undo.length > 1)) {
    const old = h.undo.shift()!
    bytes -= old.removed.length + old.inserted.length
  }
}
function undoEdit(redo = false): void {
  if (busy || !loaded || readMode) return
  capture()
  const h = history(active)
  const edit = (redo ? h.redo : h.undo).pop()
  if (!edit) return
  const remove = redo ? edit.removed : edit.inserted
  const insert = redo ? edit.inserted : edit.removed
  editor.value = editor.value.slice(0, edit.start) + insert + editor.value.slice(edit.start + remove.length)
  active.text = editor.value
  active.cursor = redo ? edit.start + insert.length : edit.cursor
  editor.setSelectionRange(active.cursor, active.cursor)
  ;(redo ? h.undo : h.redo).push(edit)
  active.updatedAt = Date.now()
  syncDirtyMarks(); metrics(); schedule(); findController.search(false)
}
editor.addEventListener('beforeinput', (event) => {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault(); undoEdit(event.inputType === 'historyRedo')
  }
})

function capture(): void {
  if (loaded && active) {
    recordEdit(active.text, editor.value)
    active.text = editor.value
    active.cursor = editor.selectionStart
  }
}

function updateReader(): void {
  if (!active) {
    reader.innerHTML = ''
    return
  }
  const text = loaded ? editor.value : (active.text ?? '')
  const parsed = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  reader.innerHTML = parsed
}

function setReadMode(enabled: boolean): void {
  readMode = enabled
  readModeBtn.classList.toggle('active', readMode)
  readModeBtn.setAttribute('aria-pressed', String(readMode))
  readModeBtn.title = readMode ? 'Exit Read Mode (Ctrl+E)' : 'Toggle Read Mode (Ctrl+E)'

  if (readMode) {
    capture()
    updateReader()
    gutter.style.display = 'none'
    editorWrap.style.display = 'none'
    readerWrap.style.display = 'block'
    readerWrap.focus()
  } else {
    readerWrap.style.display = 'none'
    gutter.style.display = ''
    editorWrap.style.display = ''
    editor.focus()
  }
}

function toggleReadMode(): void {
  setReadMode(!readMode)
}

let metricsFrame = 0
let metricsText = ''
let lineStarts = [0]
function metrics(): void {
  if (metricsFrame) return
  metricsFrame = requestAnimationFrame(() => {
    metricsFrame = 0
    const text = editor.value
    if (text !== metricsText) {
      metricsText = text
      lineStarts = [0]
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
    }
    let lo = 0, hi = lineStarts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= editor.selectionStart) lo = mid; else hi = mid - 1 }
    const height = parseFloat(getComputedStyle(editor).lineHeight) || 20
    const first = Math.max(0, Math.floor(editor.scrollTop / height) - 2)
    const last = Math.min(lineStarts.length, first + Math.ceil(editor.clientHeight / height) + 5)
    const lines = document.querySelector<HTMLElement>('#lines')!
    lines.style.paddingTop = `${3 + first * height}px`
    lines.style.paddingBottom = `${3 + (lineStarts.length - last) * height}px`
    lines.textContent = Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i + 1).join('\n')
    gutter.scrollTop = editor.scrollTop
    document.querySelector('#metrics')!.textContent = `length: ${text.length}   lines: ${lineStarts.length}`
    document.querySelector('#position')!.textContent = `Ln: ${lo + 1}   Col: ${editor.selectionStart - lineStarts[lo] + 1}   Sel: ${editor.selectionEnd - editor.selectionStart}`
  })
}
new ResizeObserver(metrics).observe(editor)

const findController = new FindReplaceController(
  document.querySelector<HTMLElement>('#find-replace-container')!,
  editor,
  () => {
    capture()
    if (active) active.updatedAt = Date.now()
    metrics()
    schedule()
  }
)

/* --------------------------------------------------------- file identity */

/**
 * Whether two paths name the same file.
 *
 * Windows paths differ only by case, and a drive letter is a reliable enough
 * tell to fold them without asking the main process what platform this is.
 * Getting this wrong opens a second tab onto one file, and then one of the two
 * silently overwrites the other's edits.
 */
function samePath(a: string, b: string): boolean {
  const windows = /^[A-Za-z]:[\\/]/.test(a)
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b
}

function findByPath(filePath: string): Draft | undefined {
  return session.buffers.find((draft) => !!draft.filePath && samePath(draft.filePath, filePath))
}

function draftFromDocument(doc: FileDocument): Draft {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    text: doc.text,
    // What is on disk right now, which is what makes the dirty check honest.
    savedText: doc.text,
    cursor: 0,
    createdAt: now,
    updatedAt: now,
    filePath: doc.path,
    eol: doc.eol,
    encoding: doc.encoding,
    bom: doc.bom
  }
}

/**
 * Whether the tab strip currently shows the active buffer as modified.
 *
 * Typing changes exactly one visible thing — the dot on one tab and the
 * asterisk in the title — and it changes it once, on the first keystroke after
 * a save. Calling `render()` for that would rebuild every tab and re-run the
 * find search on every keystroke, which is the per-keystroke work this project
 * has been bitten by before.
 */
let shownDirty: boolean | null = null

function syncDirtyMarks(): void {
  const dirty = isDirty(active)
  if (dirty === shownDirty) return
  shownDirty = dirty

  const index = session.buffers.indexOf(active)
  const icon = tabs.children[index]?.querySelector('.tab-icon')
  if (icon) {
    icon.className = dirty ? 'tab-icon dirty' : 'tab-icon'
    icon.textContent = dirty ? '●' : active.filePath ? '▤' : '✎'
  }

  const mark = dirty ? '*' : ''
  const label = draftTitle(active, index)
  document.title = `${mark}${label}${TITLE_SUFFIX}`
  document.querySelector('#title')!.textContent = `${mark}${active.filePath ?? label}${TITLE_SUFFIX}`
}

/** The status bar's account of the active buffer's file. */
function syncFileStatus(): void {
  document.querySelector('#eol')!.textContent = eolLabel(active?.eol ?? DEFAULT_EOL)
  document.querySelector('#encoding')!.textContent = encodingLabel(
    active?.encoding ?? 'utf8',
    active?.bom ?? false
  )
}

function render(): void {
  tabs.replaceChildren(
    ...session.buffers.map((draft, i) => {
      const name = draftTitle(draft, i)
      const dirty = isDirty(draft)

      const tab = document.createElement('div')
      tab.className = 'tab'
      tab.role = 'tab'
      tab.setAttribute('aria-selected', String(draft === active))
      // The full path, because a tab strip of `index.ts` tabs is otherwise a
      // guessing game about which project each one came from.
      tab.title = draft.filePath ?? 'Unsaved note'

      const icon = document.createElement('span')
      icon.className = dirty ? 'tab-icon dirty' : 'tab-icon'
      icon.textContent = dirty ? '●' : draft.filePath ? '▤' : '✎'

      const title = document.createElement('span')
      title.className = 'tab-title'
      title.textContent = name

      const closeBtn = document.createElement('button')
      closeBtn.className = 'tab-close'
      closeBtn.title = 'Close'
      closeBtn.setAttribute('aria-label', `Close ${name}`)
      closeBtn.textContent = '×'

      closeBtn.onclick = (e) => {
        e.stopPropagation()
        closeDraft(draft)
      }

      tab.onclick = () => {
        if (busy) return
        capture()
        active = draft
        active.updatedAt = Date.now()
        render()
        if (readMode) updateReader()
        void persist().catch(error)
        if (!readMode) editor.focus()
      }

      tab.append(icon, title, closeBtn)
      return tab
    })
  )

  // Each draft owns its undo history. A tab swap must never be an edit.
  if (editor.value !== active.text) editor.value = active.text
  editor.setSelectionRange(active.cursor, active.cursor)

  shownDirty = isDirty(active)
  const mark = shownDirty ? '*' : ''
  const label = draftTitle(active, session.buffers.indexOf(active))
  document.title = `${mark}${label}${TITLE_SUFFIX}`
  // The title bar gets the whole path when there is one; the tab already
  // carries the short name, so repeating it there would say nothing new.
  document.querySelector('#title')!.textContent = `${mark}${active.filePath ?? label}${TITLE_SUFFIX}`
  syncFileStatus()
  metrics()
  if (findController) findController.search(false)
  if (readMode) updateReader()
}

function add(): void {
  active = {
    id: crypto.randomUUID(),
    text: '',
    cursor: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    filePath: null,
    savedText: null,
    eol: DEFAULT_EOL,
    encoding: 'utf8',
    bom: false
  }
  session.buffers.push(active)
  render()
}

/* -------------------------------------------------------------- opening */

/**
 * Turn files read by the main process into tabs.
 *
 * Every arrival path ends up here — the command line, a second instance, the
 * Open dialog, and a drop on the window — so the three rules that make this
 * feel like an editor are stated once: a file already open is focused rather
 * than duplicated, a single untouched "new 1" is consumed rather than left
 * beside the file the user actually asked for, and a file that could not be
 * read says so instead of opening an empty tab.
 */
function openResults(results: FileOpenResult[]): void {
  if (!results.length) return
  capture()

  const failures: string[] = []
  let opened = 0

  for (const result of results) {
    if (!result.ok) {
      failures.push(`${baseName(result.path)} — ${result.error}`)
      continue
    }

    const existing = findByPath(result.doc.path)
    if (existing) {
      // Its contents are deliberately left alone. Re-opening a file with
      // unsaved edits in it must not be a way to lose them.
      if (!isDirty(existing)) {
        Object.assign(existing, { text: result.doc.text, savedText: result.doc.text, eol: result.doc.eol, encoding: result.doc.encoding, bom: result.doc.bom })
        histories.delete(existing)
      } else if (existing.savedText !== result.doc.text) {
        failures.push(`${baseName(result.doc.path)} changed on disk. Your edits are kept; use Save As to save a copy.`)
      }
      active = existing
      opened++
      continue
    }

    const only = session.buffers.length === 1 ? session.buffers[0] : null
    if (only && !only.filePath && only.text === '') session.buffers = []

    active = draftFromDocument(result.doc)
    session.buffers.push(active)
    opened++
  }

  // Every failure at once would leave nothing to show, and the tab strip is
  // never allowed to be empty.
  if (!session.buffers.length) add()
  else render()

  void persist().catch(error)
  editor.focus()

  if (failures.length) status.textContent = failures.join('   •   ')
  else if (opened) status.textContent = active.filePath ? `Opened ${active.filePath}` : 'Opened'
}

async function openFromDialog(): Promise<void> {
  if (!loaded || busy) return
  capture()
  status.textContent = 'Choose a file…'
  try {
    const results = await api.openDialog()
    if (!results.length) {
      status.textContent = 'Open cancelled'
      return
    }
    openResults(results)
  } catch (e) {
    error(e)
  }
}

/* --------------------------------------------------------------- saving */

function error(e: unknown): void {
  status.textContent = String(e)
}

const persistedDrafts = new Map<string, Draft>()
function persist(): Promise<void> {
  clearTimeout(timer)
  if (!loaded) return Promise.reject(new Error('Draft cache could not be restored.'))
  capture()
  const order = session.buffers.map((draft) => draft.id)
  const changed = session.buffers.filter((draft) => {
    const previous = persistedDrafts.get(draft.id)
    return !previous || Object.keys(draft).some((key) => draft[key as keyof Draft] !== previous[key as keyof Draft])
  }).map((draft) => ({ ...draft }))
  const snapshot: Session | null = api.persistChanges ? null : { version: 1, buffers: session.buffers.map((draft) => ({ ...draft })) }
  writes = writes.catch(() => {}).then(async () => {
    if (api.persistChanges) await api.persistChanges(changed, order)
    else await api.persist(snapshot!)
    for (const draft of changed) persistedDrafts.set(draft.id, draft)
    for (const id of persistedDrafts.keys()) if (!order.includes(id)) persistedDrafts.delete(id)
  })
  return writes
}

function schedule(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    void persist().then(() => {
      status.textContent = isDirty(active) ? modifiedLabel() : 'Saved'
    }, error)
  }, 2500)
}

function modifiedLabel(): string {
  return active?.filePath ? 'Modified — unsaved' : 'Unsaved draft'
}

function newDraft(): void {
  if (!loaded || busy) return
  if (readMode) setReadMode(false)
  capture()
  add()
  status.textContent = 'Unsaved draft'
  void persist().catch(error)
  editor.focus()
}

/**
 * Run one write, whichever kind it is.
 *
 * The editor is frozen for the duration — a keystroke landing between the
 * snapshot going to the main process and the result coming back would be
 * marked saved without ever having been written. Unlike the draft-only version
 * this replaces, a saved buffer *stays open*: that is the difference between a
 * scratchpad that files things away and an editor.
 */
async function runSave(call: () => Promise<FileSaveResult>, target: Draft): Promise<void> {
  busy = true
  editor.readOnly = true
  saving = (async () => {
    try {
      await persist()
      const written = target.text
      status.textContent = target.filePath ? 'Saving…' : 'Choose where to save…'

      const result = await call()
      if (result.cancelled) {
        status.textContent = 'Save cancelled — nothing written'
        return
      }
      if (!result.ok || !result.path) {
        status.textContent = result.error ?? 'Could not save that file.'
        return
      }

      target.filePath = result.path
      target.savedText = written
      target.updatedAt = Date.now()
      render()
      await persist()
      status.textContent = `Saved ${result.path}`
    } catch (e) {
      error(e)
    } finally {
      busy = false
      editor.readOnly = false
    }
  })()
  await saving
  saving = undefined
}

/** Ctrl+S: straight to disk once the buffer has a file; otherwise Save As. */
async function save(): Promise<void> {
  if (!loaded || busy) return
  capture()
  const target = active
  if (!target.filePath) {
    await runSave(() => api.saveAs(structuredClone(target)), target)
    return
  }
  if (!isDirty(target)) {
    status.textContent = `No changes — ${target.filePath}`
    return
  }
  await runSave(() => api.saveFile(structuredClone(target)), target)
}

/** Ctrl+Shift+S: always ask, for a copy or a rename. */
async function saveAs(): Promise<void> {
  if (!loaded || busy) return
  capture()
  const target = active
  await runSave(() => api.saveAs(structuredClone(target)), target)
}

/* -------------------------------------------------------------- closing */

function closeDraft(draftToClose: Draft): void {
  if (busy) return
  capture()

  if (isDirty(draftToClose)) {
    showCloseWarning(draftToClose)
    return
  }

  executeCloseDraft(draftToClose)
}

function executeCloseDraft(draftToClose: Draft): void {
  const wasActive = draftToClose === active
  const oldIndex = session.buffers.indexOf(draftToClose)
  session.buffers = session.buffers.filter((d) => d !== draftToClose)

  if (session.buffers.length === 0) {
    add()
  } else if (wasActive) {
    const nextIndex = Math.min(oldIndex, session.buffers.length - 1)
    active = session.buffers[nextIndex]
    render()
  } else {
    render()
  }
  void persist().catch(error)
  editor.focus()
}

function showCloseWarning(draftToClose: Draft): void {
  const existing = document.querySelector('#close-warning-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.id = 'close-warning-modal'

  const name = draftTitle(draftToClose, session.buffers.indexOf(draftToClose))
  const backed = !!draftToClose.filePath
  const detail = backed
    ? `“${draftToClose.filePath}” has unsaved changes. If you close it now, those changes are lost.`
    : `This note has unsaved content (${draftToClose.text.length} characters). If you close it, your changes will be discarded.`

  modal.innerHTML = `
    <div class="modal-dialog confirm-dialog" style="max-width: 460px;">
      <div class="modal-header">
        <h3></h3>
        <button class="modal-close-btn" id="confirm-x" title="Cancel (Esc)">×</button>
      </div>
      <div class="modal-body">
        <p style="margin: 0; line-height: 1.5; font-size: 13px;"></p>
      </div>
      <div class="modal-footer" style="justify-content: flex-end; gap: 8px;">
        <button id="confirm-cancel" class="secondary-btn">Keep Open</button>
        <button id="confirm-save" class="primary-btn">${backed ? 'Save' : 'Save As…'}</button>
        <button id="confirm-discard" class="danger-btn">Discard Changes</button>
      </div>
    </div>
  `
  // Set as text, never as markup: a file path is user data and can carry
  // anything, including something that would otherwise be parsed as HTML.
  modal.querySelector('h3')!.textContent = `Close "${name}"?`
  modal.querySelector('.modal-body p')!.textContent = detail

  const close = (): void => {
    modal.remove()
    editor.focus()
  }

  modal.querySelector('#confirm-x')!.addEventListener('click', close)
  modal.querySelector('#confirm-cancel')!.addEventListener('click', close)
  modal.addEventListener('click', (e: MouseEvent) => { if (e.target === modal) close() })

  modal.querySelector('#confirm-discard')!.addEventListener('click', () => {
    modal.remove()
    executeCloseDraft(draftToClose)
  })

  modal.querySelector('#confirm-save')!.addEventListener('click', async () => {
    modal.remove()
    active = draftToClose
    render()
    await save()
    // A cancelled Save As, or a write that failed, leaves the buffer dirty —
    // and therefore open. Closing it anyway would be the data loss the dialog
    // exists to prevent.
    if (!isDirty(draftToClose)) executeCloseDraft(draftToClose)
  })

  modalContainer.replaceChildren(modal)
}

function cycleTab(delta: number): void {
  if (session.buffers.length <= 1) return
  capture()
  const idx = session.buffers.indexOf(active)
  const nextIdx = (idx + delta + session.buffers.length) % session.buffers.length
  active = session.buffers[nextIdx]
  active.updatedAt = Date.now()
  render()
  void persist().catch(error)
  editor.focus()
}

function duplicateCurrentLine(): void {
  if (busy || !loaded) return
  const text = editor.value
  const selStart = editor.selectionStart
  const selEnd = editor.selectionEnd

  const lineStart = text.lastIndexOf('\n', selStart - 1) + 1
  let lineEnd = text.indexOf('\n', selEnd)
  if (lineEnd === -1) lineEnd = text.length

  const lineText = text.slice(lineStart, lineEnd)
  const toInsert = '\n' + lineText
  const colOffset = selStart - lineStart

  editor.focus()
  editor.setSelectionRange(lineEnd, lineEnd)

  const ok = document.execCommand('insertText', false, toInsert)
  if (!ok) {
    editor.value = text.slice(0, lineEnd) + toInsert + text.slice(lineEnd)
  }

  const newCursor = lineEnd + 1 + colOffset
  editor.setSelectionRange(newCursor, newCursor)

  capture()
  active.updatedAt = Date.now()
  metrics()
  status.textContent = modifiedLabel()
  schedule()
  findController.search(false)
}

// Toolbar button listeners
document.querySelector<HTMLButtonElement>('#new')!.onclick = newDraft
document.querySelector<HTMLButtonElement>('#open')!.onclick = () => { void openFromDialog() }
document.querySelector<HTMLButtonElement>('#save')!.onclick = () => { void save() }
document.querySelector<HTMLButtonElement>('#save-as')!.onclick = () => { void saveAs() }
document.querySelector<HTMLButtonElement>('#undo')!.onclick = () => {
  editor.focus()
  undoEdit()
}
document.querySelector<HTMLButtonElement>('#redo')!.onclick = () => {
  editor.focus()
  undoEdit(true)
}
document.querySelector<HTMLButtonElement>('#find-btn')!.onclick = () => {
  findController.toggle(false)
}
document.querySelector<HTMLButtonElement>('#theme-btn')!.onclick = () => {
  const modal = buildThemeEditorModal()
  modalContainer.replaceChildren(modal)
}
document.querySelector<HTMLButtonElement>('#shortcuts-btn')!.onclick = () => {
  const modal = buildShortcutModal()
  modalContainer.replaceChildren(modal)
}
document.querySelector<HTMLButtonElement>('#settings-btn')!.onclick = () => {
  const modal = buildSettingsModal((msg) => { status.textContent = msg })
  modalContainer.replaceChildren(modal)
}
readModeBtn.onclick = toggleReadMode

reader.addEventListener('click', (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest('a')
  if (!target) return
  const href = target.getAttribute('href')
  if (href && /^https?:\/\//i.test(href)) {
    e.preventDefault()
    window.open(href, '_blank')
  }
})

tabs.title = 'Double-click empty space to create a new note'

tabs.addEventListener('dblclick', (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('.tab-close')) return

  const tabEl = target.closest('.tab')
  if (!tabEl) {
    if (busy) return
    capture()
    add()
    editor.focus()
    void persist().catch(error)
    return
  }

  const tabIndex = Array.from(tabs.querySelectorAll('.tab')).indexOf(tabEl)
  if (tabIndex >= 0 && session.buffers[tabIndex]) {
    const draft = session.buffers[tabIndex]
    if (!draft.filePath && draft.text.trim().length === 0) {
      if (busy) return
      capture()
      add()
      editor.focus()
      void persist().catch(error)
    }
  }
})

/**
 * Files dropped on the window.
 *
 * A sandboxed renderer cannot read a `File`'s path any more, so the preload
 * hands it over via `webUtils`. Both listeners are needed: without the
 * `dragover` preventDefault the drop never fires, and Chromium would navigate
 * the window to the file instead — which the `will-navigate` guard in the main
 * process would then block, leaving nothing happening at all.
 */
document.addEventListener('dragover', (event: DragEvent) => {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
})

document.addEventListener('drop', (event: DragEvent) => {
  event.preventDefault()
  if (busy || !loaded) return
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (!dropped.length) return
  const paths = dropped.map((file) => api.pathForFile(file)).filter((p) => !!p)
  if (paths.length) void api.openPaths(paths).then(openResults, error)
})

api.onNew?.(() => {
  if (busy) return
  capture()
  add()
  editor.focus()
  void persist().catch(error)
})

api.onOpenFiles((results) => {
  if (busy) return
  openResults(results)
})

// Editor input listeners
editor.oninput = () => {
  capture()
  active.updatedAt = Date.now()
  metrics()
  status.textContent = modifiedLabel()
  // The tab's dot and the title's asterisk are the only things a keystroke can
  // change, and only on the first one after a save.
  syncDirtyMarks()
  schedule()
  findController.search(false)
}
editor.onselect = () => {
  capture()
  metrics()
  findController.syncScroll()
}
editor.onkeyup = () => {
  metrics()
  findController.syncScroll()
}
editor.onclick = () => {
  metrics()
  findController.syncScroll()
}
editor.onscroll = () => {
  metrics()
  document.querySelector('#gutter')!.scrollTop = editor.scrollTop
  findController.syncScroll()
}

api.onFlush(async (token) => {
  const slow = setTimeout(() => { status.textContent = 'Saving…' }, 300)
  try {
    await saving
    editor.readOnly = true
    await persist()
    api.flushed(token)
  } catch (e) {
    error(e)
    api.flushed(token, String(e))
  } finally {
    clearTimeout(slow)
    editor.readOnly = false
  }
})

window.onblur = () => {
  if (loaded) void persist().catch(error)
}

// Global keydown with customizable shortcuts
document.onkeydown = (event) => {
  // If a modal is open, let Esc close it
  const openModal = document.querySelector('.modal-backdrop')
  if (openModal) {
    if (event.key === 'Escape') {
      openModal.remove()
      event.preventDefault()
    }
    return
  }

  const shortcuts = getShortcuts()

  if (matchesShortcut(event, shortcuts.newDraft)) {
    event.preventDefault()
    newDraft()
    return
  }
  if (matchesShortcut(event, shortcuts.open)) {
    event.preventDefault()
    void openFromDialog()
    return
  }
  if (matchesShortcut(event, shortcuts.saveAs)) {
    event.preventDefault()
    void saveAs()
    return
  }
  if (matchesShortcut(event, shortcuts.save)) {
    event.preventDefault()
    void save()
    return
  }
  if (matchesShortcut(event, shortcuts.find)) {
    event.preventDefault()
    findController.toggle(false)
    return
  }
  if (matchesShortcut(event, shortcuts.replace)) {
    event.preventDefault()
    findController.toggle(true)
    return
  }
  if (matchesShortcut(event, shortcuts.closeTab)) {
    event.preventDefault()
    closeDraft(active)
    return
  }
  if (matchesShortcut(event, shortcuts.closeWindow)) {
    event.preventDefault()
    api.close()
    return
  }
  if (matchesShortcut(event, shortcuts.undo)) {
    const activeEl = document.activeElement
    if (activeEl && (activeEl.id === 'find-query' || activeEl.id === 'replace-text')) {
      return
    }
    event.preventDefault()
    editor.focus()
    undoEdit()
    return
  }
  if (matchesShortcut(event, shortcuts.redo)) {
    const activeEl = document.activeElement
    if (activeEl && (activeEl.id === 'find-query' || activeEl.id === 'replace-text')) {
      return
    }
    event.preventDefault()
    editor.focus()
    undoEdit(true)
    return
  }
  if (matchesShortcut(event, shortcuts.duplicateLine)) {
    event.preventDefault()
    duplicateCurrentLine()
    return
  }
  if (matchesShortcut(event, shortcuts.nextTab)) {
    event.preventDefault()
    cycleTab(1)
    return
  }
  if (matchesShortcut(event, shortcuts.prevTab)) {
    event.preventDefault()
    cycleTab(-1)
    return
  }
  if (matchesShortcut(event, shortcuts.openTheme)) {
    event.preventDefault()
    const modal = buildThemeEditorModal()
    modalContainer.replaceChildren(modal)
    return
  }
  if (matchesShortcut(event, shortcuts.openShortcuts)) {
    event.preventDefault()
    const modal = buildShortcutModal()
    modalContainer.replaceChildren(modal)
    return
  }
  if (matchesShortcut(event, shortcuts.toggleReadMode)) {
    event.preventDefault()
    toggleReadMode()
    return
  }
}

// Initial restore, then whatever the OS asked us to open on the way in.
void api.load().then(async (restored) => {
  session = restored
  const files = session.buffers.filter((draft) => draft.filePath)
  const refreshed = await api.openPaths(files.map((draft) => draft.filePath!))
  const warnings: string[] = []
  for (let i = 0; i < files.length; i++) {
    const draft = files[i], result = refreshed[i]
    if (result?.ok && !isDirty(draft)) {
      Object.assign(draft, { text: result.doc.text, savedText: result.doc.text, eol: result.doc.eol, encoding: result.doc.encoding, bom: result.doc.bom })
      draft.cursor = Math.min(draft.cursor, draft.text.length)
    } else if (!result?.ok || draft.savedText !== result.doc.text) {
      warnings.push(`${baseName(draft.filePath!)} changed or is missing. Cached edits are kept; use Save As for a recovery copy.`)
    }
  }
  session.buffers.sort((a, b) => a.updatedAt - b.updatedAt)
  active = session.buffers[session.buffers.length - 1]
  if (!active) add(); else render()
  loaded = true
  editor.disabled = false
  editor.focus()
  status.textContent = warnings.length ? warnings.join(' ') : isDirty(active) ? modifiedLabel() : 'Ready'

  // A double-click that started this process queued its file before there was
  // a renderer to show it in. Draining here rather than pushing from main is
  // what makes a cold start and an already-running window the same code path.
  try {
    const pendingOpen = await api.takePendingFiles()
    if (pendingOpen.length) openResults(pendingOpen)
  } catch (e) {
    error(e)
  }
}, error)
