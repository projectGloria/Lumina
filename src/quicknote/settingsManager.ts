import { getThemeConfig, setThemeConfig, DEFAULT_THEME_CONFIG } from './themeManager'
import { getShortcuts, setShortcuts, DEFAULT_SHORTCUTS } from './shortcutManager'
import { serializeSettingsPayload, parseSettingsPayload, type FullQuickNoteSettings } from '../shared/quicknoteSettings'

export { type FullQuickNoteSettings }

export function exportSettingsData(): string {
  return serializeSettingsPayload(getThemeConfig(), getShortcuts())
}

export function importSettingsData(jsonStr: string): { success: boolean; message: string } {
  const result = parseSettingsPayload(jsonStr)
  if (!result.success || !result.data) {
    return { success: false, message: result.message }
  }

  setThemeConfig(result.data.theme)
  setShortcuts(result.data.shortcuts)
  return { success: true, message: 'Settings imported and applied successfully!' }
}

export async function triggerExport(): Promise<boolean> {
  const content = exportSettingsData()
  if (window.quicknote?.exportSettings) {
    const ok = await window.quicknote.exportSettings(content)
    if (ok) return true
  }

  // Fallback to browser blob download
  try {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'quicknote-settings.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

export async function triggerImport(): Promise<{ success: boolean; message: string }> {
  if (window.quicknote?.importSettings) {
    const content = await window.quicknote.importSettings()
    if (!content) return { success: false, message: 'Import cancelled' }
    return importSettingsData(content)
  }

  // Fallback to file input
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve({ success: false, message: 'No file selected' })
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        resolve(importSettingsData(String(reader.result || '')))
      }
      reader.onerror = () => {
        resolve({ success: false, message: 'Error reading file' })
      }
      reader.readAsText(file)
    }
    input.click()
  })
}

export function buildSettingsModal(onStatus?: (msg: string) => void): HTMLElement {
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.id = 'settings-modal'

  const renderContent = (notice = ''): void => {
    modal.innerHTML = `
      <div class="modal-dialog settings-dialog">
        <div class="modal-header">
          <h3>Quick Note Settings & Backups</h3>
          <button class="modal-close-btn" id="settings-modal-close" title="Close (Esc)">×</button>
        </div>
        <div class="modal-body settings-body">
          ${notice ? `<div class="settings-banner">${notice}</div>` : ''}
          <section class="settings-section">
            <h4>Export / Backup</h4>
            <p>Save all your custom themes, colors, typography preferences, and keyboard shortcuts to a JSON backup file.</p>
            <button id="btn-export-settings" class="primary-btn">⬇ Export All Settings (.json)</button>
          </section>

          <section class="settings-section">
            <h4>Import / Restore</h4>
            <p>Load and restore your theme and shortcut configuration from a previously exported JSON file.</p>
            <button id="btn-import-settings" class="secondary-btn">⬆ Import Settings from File…</button>
          </section>

          <section class="settings-section">
            <h4>Desktop Shortcut</h4>
            <p>Create a dedicated Quick Note shortcut with its own custom amber lightning icon on your desktop.</p>
            <button id="btn-create-desktop-shortcut" class="secondary-btn">🗲 Create Quick Note Shortcut on Desktop</button>
          </section>

          <section class="settings-section danger-zone">
            <h4>Factory Reset</h4>
            <p>Restore all themes, fonts, and keyboard shortcuts to their original default settings.</p>
            <button id="btn-reset-all" class="danger-btn">⚠ Reset All to Factory Defaults</button>
          </section>
        </div>
        <div class="modal-footer">
          <div style="flex: 1"></div>
          <button id="settings-done-btn" class="primary-btn">Done</button>
        </div>
      </div>
    `

    const close = (): void => {
      modal.remove()
    }

    modal.querySelector('#settings-modal-close')!.addEventListener('click', close)
    modal.querySelector('#settings-done-btn')!.addEventListener('click', close)
    modal.addEventListener('click', (e: MouseEvent) => { if (e.target === modal) close() })

    modal.querySelector('#btn-export-settings')!.addEventListener('click', async () => {
      const ok = await triggerExport()
      if (ok) {
        renderContent('✓ Settings exported successfully!')
        if (onStatus) onStatus('Settings exported successfully')
      }
    })

    modal.querySelector('#btn-import-settings')!.addEventListener('click', async () => {
      const result = await triggerImport()
      renderContent(result.success ? `✓ ${result.message}` : `⚠ ${result.message}`)
      if (onStatus) onStatus(result.message)
    })

    modal.querySelector('#btn-create-desktop-shortcut')?.addEventListener('click', async () => {
      if (window.quicknote?.createDesktopShortcut) {
        const res = await window.quicknote.createDesktopShortcut()
        if (res.ok) {
          renderContent('✓ Quick Note shortcut created on Desktop!')
          if (onStatus) onStatus('Shortcut created on Desktop')
        } else {
          renderContent(`⚠ ${res.error || 'Failed to create shortcut'}`)
          if (onStatus) onStatus(res.error || 'Failed to create shortcut')
        }
      }
    })

    modal.querySelector('#btn-reset-all')!.addEventListener('click', () => {
      if (window.confirm('Are you sure you want to reset all themes, fonts, and shortcuts to default?')) {
        setThemeConfig(DEFAULT_THEME_CONFIG)
        const defKeys: Record<string, string> = {}
        for (const [k, v] of Object.entries(DEFAULT_SHORTCUTS)) defKeys[k] = v.defaultKey
        setShortcuts(defKeys)
        renderContent('✓ All settings reset to factory defaults.')
        if (onStatus) onStatus('All settings reset to factory defaults')
      }
    })
  }

  renderContent()
  return modal
}
