import './style.css'
import type { Draft, QuickApi, Session } from '../shared/quicknoteSession'
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

let session: Session = { version: 1, buffers: [] }
let active: Draft
let loaded = false
let busy = false
let timer: ReturnType<typeof setTimeout>
let writes = Promise.resolve()
let saving: Promise<void> | undefined

// Initialize subsystems
initTheme()
initShortcuts()

function capture(): void {
  if (loaded && active) {
    active.text = editor.value
    active.cursor = editor.selectionStart
  }
}

function metrics(): void {
  const lines = editor.value.split('\n')
  document.querySelector('#lines')!.textContent = lines.map((_l, i) => i + 1).join('\n')
  const before = editor.value.slice(0, editor.selectionStart).split('\n')
  document.querySelector('#metrics')!.textContent = `length: ${editor.value.length}   lines: ${lines.length}`
  document.querySelector('#position')!.textContent = `Ln: ${before.length}   Col: ${before.at(-1)!.length + 1}   Sel: ${editor.selectionEnd - editor.selectionStart}`
}

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

function render(): void {
  tabs.replaceChildren(
    ...session.buffers.map((draft, i) => {
      const tab = document.createElement('div')
      tab.className = 'tab'
      tab.role = 'tab'
      tab.setAttribute('aria-selected', String(draft === active))

      const icon = document.createElement('span')
      icon.className = 'tab-icon'
      icon.textContent = '✎'

      const title = document.createElement('span')
      title.className = 'tab-title'
      title.textContent = 'new ' + (i + 1)

      const closeBtn = document.createElement('button')
      closeBtn.className = 'tab-close'
      closeBtn.title = 'Close note'
      closeBtn.setAttribute('aria-label', `Close note new ${i + 1}`)
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
        void persist().catch(error)
        editor.focus()
      }

      tab.append(icon, title, closeBtn)
      return tab
    })
  )

  editor.value = active.text
  editor.setSelectionRange(active.cursor, active.cursor)
  document.title = `new ${session.buffers.indexOf(active) + 1} - Quick Note`
  document.querySelector('#title')!.textContent = document.title
  metrics()
  if (findController) findController.search(false)
}

function add(): void {
  active = {
    id: crypto.randomUUID(),
    text: '',
    cursor: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  session.buffers.push(active)
  render()
}

function closeDraft(draftToClose: Draft): void {
  if (busy) return
  capture()

  if (draftToClose.text.length > 0) {
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

  const noteIndex = session.buffers.indexOf(draftToClose) + 1

  modal.innerHTML = `
    <div class="modal-dialog confirm-dialog" style="max-width: 420px;">
      <div class="modal-header">
        <h3>Discard "new ${noteIndex}"?</h3>
        <button class="modal-close-btn" id="confirm-x" title="Cancel (Esc)">×</button>
      </div>
      <div class="modal-body">
        <p style="margin: 0; line-height: 1.5; font-size: 13px;">
          This note has unsaved content (${draftToClose.text.length} characters). If you close it, your changes will be discarded.
        </p>
      </div>
      <div class="modal-footer" style="justify-content: flex-end; gap: 8px;">
        <button id="confirm-cancel" class="secondary-btn">Keep Note</button>
        <button id="confirm-save-as" class="primary-btn">Save As…</button>
        <button id="confirm-discard" class="danger-btn">Discard Note</button>
      </div>
    </div>
  `

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

  modal.querySelector('#confirm-save-as')!.addEventListener('click', async () => {
    modal.remove()
    active = draftToClose
    render()
    await save()
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
  status.textContent = 'Unsaved draft'
  schedule()
  findController.renderHighlights()
}

function error(e: unknown): void {
  status.textContent = String(e)
}

function persist(): Promise<void> {
  clearTimeout(timer)
  if (!loaded) return Promise.reject(new Error('Draft cache could not be restored.'))
  capture()
  const snapshot = structuredClone(session)
  writes = writes.catch(() => {}).then(() => api.persist(snapshot))
  return writes
}

function schedule(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    void persist().then(() => {
      status.textContent = 'Draft cached'
    }, error)
  }, 2500)
}

function newDraft(): void {
  if (!loaded || busy) return
  capture()
  add()
  status.textContent = 'Unsaved draft'
  void persist().catch(error)
  editor.focus()
}

async function save(): Promise<void> {
  if (!loaded || busy) return
  busy = true
  editor.readOnly = true
  saving = (async () => {
    try {
      await persist()
      status.textContent = 'Choose where to save…'
      const file = await api.save(structuredClone(active))
      if (!file) {
        status.textContent = 'Save cancelled — draft kept'
        return
      }
      session.buffers = session.buffers.filter((draft) => draft !== active)
      if (session.buffers.length) {
        active = session.buffers[session.buffers.length - 1]
        render()
      } else {
        add()
      }
      await persist()
      status.textContent = 'Saved: ' + file
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

// Toolbar button listeners
document.querySelector<HTMLButtonElement>('#new')!.onclick = newDraft
document.querySelector<HTMLButtonElement>('#save')!.onclick = () => { void save() }
document.querySelector<HTMLButtonElement>('#undo')!.onclick = () => {
  editor.focus()
  document.execCommand('undo')
}
document.querySelector<HTMLButtonElement>('#redo')!.onclick = () => {
  editor.focus()
  document.execCommand('redo')
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
    if (draft.text.trim().length === 0) {
      if (busy) return
      capture()
      add()
      editor.focus()
      void persist().catch(error)
    }
  }
})

api.onNew?.(() => {
  if (busy) return
  capture()
  add()
  editor.focus()
  void persist().catch(error)
})

// Editor input listeners
editor.oninput = () => {
  capture()
  active.updatedAt = Date.now()
  metrics()
  status.textContent = 'Unsaved draft'
  schedule()
  findController.renderHighlights()
}
editor.onselect = () => {
  capture()
  metrics()
  schedule()
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
    document.execCommand('undo')
    return
  }
  if (matchesShortcut(event, shortcuts.redo)) {
    const activeEl = document.activeElement
    if (activeEl && (activeEl.id === 'find-query' || activeEl.id === 'replace-text')) {
      return
    }
    event.preventDefault()
    editor.focus()
    document.execCommand('redo')
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
}

// Initial restore
void api.load().then((restored) => {
  session = restored
  session.buffers.sort((a, b) => a.updatedAt - b.updatedAt)
  active = session.buffers[session.buffers.length - 1]
  if (!active) add(); else render()
  loaded = true
  editor.disabled = false
  editor.focus()
  status.textContent = 'Unsaved draft'
}, error)
