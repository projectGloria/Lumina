import {
  type ShortcutDefinition,
  DEFAULT_SHORTCUTS,
  formatKeyCombination,
  matchesShortcut
} from '../shared/quicknoteShortcuts'

export {
  type ShortcutDefinition,
  DEFAULT_SHORTCUTS,
  formatKeyCombination,
  matchesShortcut
}

const STORAGE_KEY = 'quicknote-shortcuts'

let currentShortcuts: Record<string, string> = {}

export function getShortcuts(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
    result[id] = currentShortcuts[id] || def.defaultKey
  }
  return result
}

export function setShortcuts(newMap: Record<string, string>): void {
  currentShortcuts = { ...newMap }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentShortcuts))
    }
  } catch {}
}

export function initShortcuts(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        currentShortcuts = JSON.parse(raw)
      }
    }
  } catch {}
}

export function formatEventAsShortcut(e: KeyboardEvent): string | null {
  return formatKeyCombination(e)
}

export function buildShortcutModal(onClose?: () => void): HTMLElement {
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.id = 'shortcut-editor-modal'

  let draftShortcuts = getShortcuts()
  let recordingActionId: string | null = null
  let conflictMessage = ''

  const renderContent = (): void => {
    modal.innerHTML = `
      <div class="modal-dialog shortcut-editor-dialog">
        <div class="modal-header">
          <h3>Keyboard Shortcuts Editor</h3>
          <button class="modal-close-btn" id="shortcut-modal-close" title="Close (Esc)">×</button>
        </div>
        <div class="modal-body shortcut-editor-body">
          <p class="shortcut-tip">Click any key combination to record a new shortcut. Press Escape to cancel recording.</p>
          ${conflictMessage ? `<div class="shortcut-conflict-banner">${conflictMessage}</div>` : ''}
          <div class="shortcut-table">
            <div class="shortcut-header-row">
              <span class="col-name">Action</span>
              <span class="col-desc">Description</span>
              <span class="col-key">Shortcut</span>
              <span class="col-act">Reset</span>
            </div>
            ${Object.entries(DEFAULT_SHORTCUTS).map(([id, def]) => {
              const currentKey = draftShortcuts[id] || def.defaultKey
              const isRecording = recordingActionId === id
              return `
                <div class="shortcut-row ${isRecording ? 'recording' : ''}" data-action-id="${id}">
                  <span class="col-name"><strong>${def.name}</strong></span>
                  <span class="col-desc">${def.description}</span>
                  <span class="col-key">
                    <button class="shortcut-key-btn ${isRecording ? 'recording-btn' : ''}" data-action-id="${id}">
                      ${isRecording ? '⏺ Press keys…' : currentKey}
                    </button>
                  </span>
                  <span class="col-act">
                    <button class="shortcut-reset-item-btn" data-reset-id="${id}" title="Reset to ${def.defaultKey}">↺</button>
                  </span>
                </div>
              `
            }).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button id="shortcut-reset-all-btn" class="secondary-btn">Reset All to Defaults</button>
          <div style="flex: 1"></div>
          <button id="shortcut-cancel-btn" class="secondary-btn">Cancel</button>
          <button id="shortcut-save-btn" class="primary-btn">Save Shortcuts</button>
        </div>
      </div>
    `

    const close = (): void => {
      window.removeEventListener('keydown', onGlobalKeyDown, true)
      modal.remove()
      if (onClose) onClose()
    }

    modal.querySelector('#shortcut-modal-close')!.addEventListener('click', close)
    modal.querySelector('#shortcut-cancel-btn')!.addEventListener('click', close)
    modal.addEventListener('click', (e: MouseEvent) => { if (e.target === modal) close() })

    // Wire record buttons
    modal.querySelectorAll<HTMLButtonElement>('.shortcut-key-btn').forEach((btn: HTMLButtonElement) => {
      btn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation()
        recordingActionId = btn.dataset.actionId || null
        conflictMessage = ''
        renderContent()
      })
    })

    // Wire individual reset buttons
    modal.querySelectorAll<HTMLButtonElement>('.shortcut-reset-item-btn').forEach((btn: HTMLButtonElement) => {
      btn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation()
        const id = btn.dataset.resetId!
        if (DEFAULT_SHORTCUTS[id]) {
          draftShortcuts[id] = DEFAULT_SHORTCUTS[id].defaultKey
          conflictMessage = ''
          renderContent()
        }
      })
    })

    // Reset all
    modal.querySelector('#shortcut-reset-all-btn')!.addEventListener('click', () => {
      const resetMap: Record<string, string> = {}
      for (const [k, v] of Object.entries(DEFAULT_SHORTCUTS)) {
        resetMap[k] = v.defaultKey
      }
      draftShortcuts = resetMap
      conflictMessage = ''
      renderContent()
    })

    // Save
    modal.querySelector('#shortcut-save-btn')!.addEventListener('click', () => {
      setShortcuts(draftShortcuts)
      close()
    })
  }

  const onGlobalKeyDown = (e: KeyboardEvent): void => {
    if (!recordingActionId) return
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      recordingActionId = null
      renderContent()
      return
    }

    const combination = formatEventAsShortcut(e)
    if (!combination) return // modifier key alone

    // Check conflict
    const conflicting = Object.entries(draftShortcuts).find(
      ([id, key]) => id !== recordingActionId && key.toLowerCase() === combination.toLowerCase()
    )

    if (conflicting) {
      conflictMessage = `Warning: "${combination}" was already used for "${DEFAULT_SHORTCUTS[conflicting[0]]?.name || conflicting[0]}".`
    } else {
      conflictMessage = ''
    }

    draftShortcuts[recordingActionId] = combination
    recordingActionId = null
    renderContent()
  }

  window.addEventListener('keydown', onGlobalKeyDown, true)
  renderContent()
  return modal
}
