import {
  type ThemeColors,
  type TypographySettings,
  type ThemeConfig,
  PRESET_THEMES,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_THEME_CONFIG
} from '../shared/quicknoteTheme'

export {
  type ThemeColors,
  type TypographySettings,
  type ThemeConfig,
  PRESET_THEMES,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_THEME_CONFIG
}

const STORAGE_KEY = 'quicknote-theme-config'

let currentConfig: ThemeConfig = { ...DEFAULT_THEME_CONFIG }
let installedFonts: string[] = []

const DEFAULT_FONTS = [
  'Consolas',
  'Cascadia Code',
  'Cascadia Mono',
  'Courier New',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Lucida Console',
  'Segoe UI',
  'Arial',
  'Calibri',
  'Georgia',
  'Tahoma',
  'Verdana'
]

export async function loadInstalledFonts(): Promise<string[]> {
  if (installedFonts.length > 0) return installedFonts
  if (typeof window !== 'undefined' && window.quicknote?.getFonts) {
    try {
      const fonts = await window.quicknote.getFonts()
      if (fonts && fonts.length > 0) {
        installedFonts = fonts
        return installedFonts
      }
    } catch {}
  }
  installedFonts = [...DEFAULT_FONTS]
  return installedFonts
}

export function applyTheme(config: ThemeConfig): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const { colors, typography } = config
  const isLight = config.name === 'light' || config.colors.paper.toLowerCase() === '#ffffff'
  root.dataset.theme = isLight ? 'light' : 'dark'
  root.style.colorScheme = isLight ? 'light' : 'dark'

  root.style.setProperty('--paper', colors.paper)
  root.style.setProperty('--ink', colors.ink)
  root.style.setProperty('--chrome', colors.chrome)
  root.style.setProperty('--titlebar', colors.titlebar)
  root.style.setProperty('--gutter', colors.gutter)
  root.style.setProperty('--gutter-ink', colors.gutterInk)
  root.style.setProperty('--tab-bg', colors.tabBg)
  root.style.setProperty('--tab-active-bg', colors.tabActiveBg)
  root.style.setProperty('--tab-accent', colors.tabAccent)
  root.style.setProperty('--tab-ink', colors.tabInk)
  root.style.setProperty('--selection-bg', colors.selectionBg)
  root.style.setProperty('--caret-color', colors.caretColor)
  root.style.setProperty('--border-color', colors.borderColor)

  root.style.setProperty('--editor-font', typography.editorFont)
  root.style.setProperty('--editor-size', typography.editorSize + 'px')
  root.style.setProperty('--editor-line-height', typography.editorLineHeight + 'px')
  root.style.setProperty('--editor-weight', typography.editorWeight)
  root.style.setProperty('--editor-spacing', typography.editorSpacing + 'px')
  root.style.setProperty('--tab-size', String(typography.tabSize))
  root.style.setProperty('--ui-font', typography.uiFont)
  root.style.setProperty('--ui-size', typography.uiSize + 'px')
}

export function getThemeConfig(): ThemeConfig {
  return structuredClone(currentConfig)
}

export function setThemeConfig(config: ThemeConfig): void {
  currentConfig = structuredClone(config)
  applyTheme(currentConfig)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig))
    }
  } catch {}
}

export function initTheme(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ThemeConfig>
        currentConfig = {
          name: parsed.name || DEFAULT_THEME_CONFIG.name,
          colors: { ...DEFAULT_THEME_CONFIG.colors, ...(parsed.colors || {}) },
          typography: { ...DEFAULT_THEME_CONFIG.typography, ...(parsed.typography || {}) }
        }
      }
    }
  } catch {}
  applyTheme(currentConfig)
  void loadInstalledFonts()
}

export function buildThemeEditorModal(onClose?: () => void): HTMLElement {
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.id = 'theme-editor-modal'

  let draftConfig = structuredClone(currentConfig)

  const renderContent = (): void => {
    // Collect all font choices
    const fontList = [...(installedFonts.length > 0 ? installedFonts : DEFAULT_FONTS)]
    const currentFont = draftConfig.typography.editorFont
    if (!fontList.includes(currentFont)) {
      fontList.unshift(currentFont)
    }

    modal.innerHTML = `
      <div class="modal-dialog theme-editor-dialog">
        <div class="modal-header">
          <h3>Detailed Theme & Typography Editor</h3>
          <button class="modal-close-btn" id="theme-modal-close" title="Close (Esc)">×</button>
        </div>
        <div class="modal-body theme-editor-body">
          <section class="theme-section">
            <h4>Presets</h4>
            <div class="theme-row">
              <label for="theme-preset-select">Theme Preset</label>
              <select id="theme-preset-select">
                ${Object.entries(PRESET_THEMES).map(([key, p]) => `
                  <option value="${key}" ${draftConfig.name === key ? 'selected' : ''}>${p.name}</option>
                `).join('')}
                <option value="custom" ${!PRESET_THEMES[draftConfig.name] ? 'selected' : ''}>Custom</option>
              </select>
            </div>
          </section>

          <section class="theme-section">
            <h4>Colors</h4>
            <div class="color-grid">
              ${[
                { id: 'paper', label: 'Editor Background', val: draftConfig.colors.paper },
                { id: 'ink', label: 'Editor Text', val: draftConfig.colors.ink },
                { id: 'chrome', label: 'Toolbar Background', val: draftConfig.colors.chrome },
                { id: 'titlebar', label: 'Titlebar Background', val: draftConfig.colors.titlebar },
                { id: 'gutter', label: 'Gutter Background', val: draftConfig.colors.gutter },
                { id: 'gutterInk', label: 'Line Numbers', val: draftConfig.colors.gutterInk },
                { id: 'tabBg', label: 'Tab Background', val: draftConfig.colors.tabBg === 'transparent' ? '#202020' : draftConfig.colors.tabBg },
                { id: 'tabActiveBg', label: 'Active Tab Background', val: draftConfig.colors.tabActiveBg },
                { id: 'tabAccent', label: 'Tab Accent Line', val: draftConfig.colors.tabAccent },
                { id: 'tabInk', label: 'Tab Text', val: draftConfig.colors.tabInk },
                { id: 'selectionBg', label: 'Selection Color', val: draftConfig.colors.selectionBg.slice(0, 7) },
                { id: 'caretColor', label: 'Cursor Color', val: draftConfig.colors.caretColor },
                { id: 'borderColor', label: 'Borders & Dividers', val: draftConfig.colors.borderColor }
              ].map(({ id, label, val }) => `
                <div class="color-field">
                  <label for="color-${id}">${label}</label>
                  <div class="color-picker-wrap">
                    <input type="color" id="color-${id}" data-color-id="${id}" value="${val.length === 7 ? val : '#3f3f3f'}">
                    <input type="text" id="hex-${id}" data-hex-id="${id}" value="${val}" spellcheck="false">
                  </div>
                </div>
              `).join('')}
            </div>
          </section>

          <section class="theme-section">
            <h4>Fonts & Typography</h4>
            <div class="theme-row">
              <label for="editor-font-select">Editor Font (Installed)</label>
              <select id="editor-font-select">
                ${fontList.map((f) => `
                  <option value="${f}" ${f === currentFont ? 'selected' : ''}>${f}</option>
                `).join('')}
              </select>
            </div>
            <div class="theme-row">
              <label for="editor-size-input">Font Size: <span id="size-val">${draftConfig.typography.editorSize}px</span></label>
              <input type="range" id="editor-size-input" min="10" max="32" step="1" value="${draftConfig.typography.editorSize}">
            </div>
            <div class="theme-row">
              <label for="editor-line-input">Line Height: <span id="line-val">${draftConfig.typography.editorLineHeight}px</span></label>
              <input type="range" id="editor-line-input" min="14" max="44" step="1" value="${draftConfig.typography.editorLineHeight}">
            </div>
            <div class="theme-row">
              <label for="editor-weight-select">Font Weight</label>
              <select id="editor-weight-select">
                <option value="300" ${draftConfig.typography.editorWeight === '300' ? 'selected' : ''}>Light (300)</option>
                <option value="400" ${draftConfig.typography.editorWeight === '400' ? 'selected' : ''}>Regular (400)</option>
                <option value="500" ${draftConfig.typography.editorWeight === '500' ? 'selected' : ''}>Medium (500)</option>
                <option value="600" ${draftConfig.typography.editorWeight === '600' ? 'selected' : ''}>Semi-Bold (600)</option>
                <option value="700" ${draftConfig.typography.editorWeight === '700' ? 'selected' : ''}>Bold (700)</option>
              </select>
            </div>
            <div class="theme-row">
              <label for="editor-spacing-input">Letter Spacing: <span id="spacing-val">${draftConfig.typography.editorSpacing}px</span></label>
              <input type="range" id="editor-spacing-input" min="-1" max="4" step="0.5" value="${draftConfig.typography.editorSpacing}">
            </div>
            <div class="theme-row">
              <label for="tab-size-select">Tab Size</label>
              <select id="tab-size-select">
                <option value="2" ${draftConfig.typography.tabSize === 2 ? 'selected' : ''}>2 spaces</option>
                <option value="4" ${draftConfig.typography.tabSize === 4 ? 'selected' : ''}>4 spaces</option>
                <option value="8" ${draftConfig.typography.tabSize === 8 ? 'selected' : ''}>8 spaces</option>
              </select>
            </div>
            <div class="theme-row">
              <label for="ui-font-input">UI Font Family</label>
              <input type="text" id="ui-font-input" value="${draftConfig.typography.uiFont}">
            </div>
          </section>
        </div>
        <div class="modal-footer">
          <button id="theme-reset-btn" class="secondary-btn">Reset to Default</button>
          <div style="flex: 1"></div>
          <button id="theme-cancel-btn" class="secondary-btn">Cancel</button>
          <button id="theme-save-btn" class="primary-btn">Apply & Save</button>
        </div>
      </div>
    `

    // Wire events
    const close = (): void => {
      applyTheme(currentConfig) // revert any unsaved preview
      modal.remove()
      if (onClose) onClose()
    }

    modal.querySelector('#theme-modal-close')!.addEventListener('click', close)
    modal.querySelector('#theme-cancel-btn')!.addEventListener('click', close)
    modal.addEventListener('click', (e: MouseEvent) => { if (e.target === modal) close() })

    // Presets dropdown
    const presetSelect = modal.querySelector<HTMLSelectElement>('#theme-preset-select')!
    presetSelect.addEventListener('change', () => {
      const selected = presetSelect.value
      if (PRESET_THEMES[selected]) {
        draftConfig.name = selected
        draftConfig.colors = { ...PRESET_THEMES[selected].colors }
        applyTheme(draftConfig)
        renderContent()
      }
    })

    // Colors
    modal.querySelectorAll<HTMLInputElement>('input[data-color-id]').forEach((colorInput: HTMLInputElement) => {
      const colorId = colorInput.dataset.colorId as keyof ThemeColors
      const hexInput = modal.querySelector<HTMLInputElement>(`#hex-${colorId}`)!

      const updateColor = (newVal: string): void => {
        draftConfig.colors[colorId] = newVal
        draftConfig.name = 'custom'
        presetSelect.value = 'custom'
        applyTheme(draftConfig)
      }

      colorInput.addEventListener('input', () => {
        hexInput.value = colorInput.value
        updateColor(colorInput.value)
      })

      hexInput.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{3,8}$/.test(hexInput.value)) {
          if (hexInput.value.length === 7) colorInput.value = hexInput.value
          updateColor(hexInput.value)
        }
      })
    })

    // Fonts dropdown
    const fontSelect = modal.querySelector<HTMLSelectElement>('#editor-font-select')!
    fontSelect.addEventListener('change', () => {
      draftConfig.typography.editorFont = fontSelect.value
      applyTheme(draftConfig)
    })

    // Size slider
    const sizeInput = modal.querySelector<HTMLInputElement>('#editor-size-input')!
    const sizeVal = modal.querySelector<HTMLElement>('#size-val')!
    sizeInput.addEventListener('input', () => {
      draftConfig.typography.editorSize = Number(sizeInput.value)
      sizeVal.textContent = sizeInput.value + 'px'
      applyTheme(draftConfig)
    })

    // Line height slider
    const lineInput = modal.querySelector<HTMLInputElement>('#editor-line-input')!
    const lineVal = modal.querySelector<HTMLElement>('#line-val')!
    lineInput.addEventListener('input', () => {
      draftConfig.typography.editorLineHeight = Number(lineInput.value)
      lineVal.textContent = lineInput.value + 'px'
      applyTheme(draftConfig)
    })

    // Weight
    const weightSelect = modal.querySelector<HTMLSelectElement>('#editor-weight-select')!
    weightSelect.addEventListener('change', () => {
      draftConfig.typography.editorWeight = weightSelect.value
      applyTheme(draftConfig)
    })

    // Spacing
    const spacingInput = modal.querySelector<HTMLInputElement>('#editor-spacing-input')!
    const spacingVal = modal.querySelector<HTMLElement>('#spacing-val')!
    spacingInput.addEventListener('input', () => {
      draftConfig.typography.editorSpacing = Number(spacingInput.value)
      spacingVal.textContent = spacingInput.value + 'px'
      applyTheme(draftConfig)
    })

    // Tab size
    const tabSizeSelect = modal.querySelector<HTMLSelectElement>('#tab-size-select')!
    tabSizeSelect.addEventListener('change', () => {
      draftConfig.typography.tabSize = Number(tabSizeSelect.value)
      applyTheme(draftConfig)
    })

    // UI font
    const uiFontInput = modal.querySelector<HTMLInputElement>('#ui-font-input')!
    uiFontInput.addEventListener('input', () => {
      draftConfig.typography.uiFont = uiFontInput.value
      applyTheme(draftConfig)
    })

    // Reset button
    modal.querySelector('#theme-reset-btn')!.addEventListener('click', () => {
      draftConfig = structuredClone(DEFAULT_THEME_CONFIG)
      applyTheme(draftConfig)
      renderContent()
    })

    // Save button
    modal.querySelector('#theme-save-btn')!.addEventListener('click', () => {
      setThemeConfig(draftConfig)
      modal.remove()
      if (onClose) onClose()
    })
  }

  if (installedFonts.length === 0) {
    loadInstalledFonts().then(() => {
      if (modal.isConnected) renderContent()
    })
  }

  renderContent()
  return modal
}
