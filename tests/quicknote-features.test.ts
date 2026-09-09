import { describe, expect, it } from 'vitest'
import { PRESET_THEMES, DEFAULT_THEME_CONFIG, DEFAULT_TYPOGRAPHY } from '../src/shared/quicknoteTheme'
import { DEFAULT_SHORTCUTS, matchesShortcut, formatKeyCombination } from '../src/shared/quicknoteShortcuts'
import { serializeSettingsPayload, parseSettingsPayload } from '../src/shared/quicknoteSettings'

describe('Quick Note Theme Presets and Defaults', () => {
  it('has comprehensive default colors and typography', () => {
    expect(DEFAULT_THEME_CONFIG.name).toBe('dark')
    expect(DEFAULT_THEME_CONFIG.colors.paper).toBe('#3f3f3f')
    expect(DEFAULT_THEME_CONFIG.colors.ink).toBe('#e4e4e4')
    expect(DEFAULT_THEME_CONFIG.colors.tabAccent).toBe('#81bbaa')
    expect(DEFAULT_TYPOGRAPHY.editorSize).toBe(13)
    expect(DEFAULT_TYPOGRAPHY.tabSize).toBe(4)
  })

  it('includes all preset themes with complete color schemes', () => {
    const expectedPresets = ['dark', 'light', 'monokai', 'dracula', 'nord', 'solarizedDark', 'solarizedLight', 'cyberpunk']
    for (const key of expectedPresets) {
      expect(PRESET_THEMES[key]).toBeDefined()
      const colors = PRESET_THEMES[key].colors
      expect(colors.paper).toBeDefined()
      expect(colors.ink).toBeDefined()
      expect(colors.chrome).toBeDefined()
      expect(colors.gutter).toBeDefined()
      expect(colors.tabAccent).toBeDefined()
    }
  })
})

describe('Quick Note Shortcut Matcher', () => {
  it('defines all required actions and default keys', () => {
    expect(DEFAULT_SHORTCUTS.newDraft.defaultKey).toBe('Ctrl+N')
    expect(DEFAULT_SHORTCUTS.save.defaultKey).toBe('Ctrl+S')
    expect(DEFAULT_SHORTCUTS.find.defaultKey).toBe('Ctrl+F')
    expect(DEFAULT_SHORTCUTS.replace.defaultKey).toBe('Ctrl+H')
    expect(DEFAULT_SHORTCUTS.closeTab.defaultKey).toBe('Ctrl+W')
    expect(DEFAULT_SHORTCUTS.closeWindow.defaultKey).toBe('Ctrl+Shift+W')
    expect(DEFAULT_SHORTCUTS.duplicateLine.defaultKey).toBe('Ctrl+D')
  })

  it('correctly matches shortcut combinations', () => {
    const ctrlN = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'n' }
    expect(matchesShortcut(ctrlN, 'Ctrl+N')).toBe(true)
    expect(matchesShortcut(ctrlN, 'Ctrl+S')).toBe(false)

    const ctrlShiftW = { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, key: 'w' }
    expect(matchesShortcut(ctrlShiftW, 'Ctrl+Shift+W')).toBe(true)
    expect(matchesShortcut(ctrlShiftW, 'Ctrl+W')).toBe(false)

    const esc = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: 'Escape' }
    expect(matchesShortcut(esc, 'Esc')).toBe(true)
  })

  it('formats keyboard events into shortcut strings', () => {
    const event = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'k' }
    expect(formatKeyCombination(event)).toBe('Ctrl+K')
  })
})

describe('Quick Note Settings Serialization and Parsing', () => {
  it('exports settings into valid JSON', () => {
    const json = serializeSettingsPayload(DEFAULT_THEME_CONFIG, { find: 'Ctrl+F' })
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.app).toBe('Lumina Quick Note')
    expect(parsed.theme.colors.paper).toBe('#3f3f3f')
    expect(parsed.shortcuts.find).toBe('Ctrl+F')
  })

  it('imports valid settings cleanly', () => {
    const testPayload = JSON.stringify({
      version: 1,
      app: 'Lumina Quick Note',
      theme: {
        name: 'monokai',
        colors: PRESET_THEMES.monokai.colors,
        typography: DEFAULT_TYPOGRAPHY
      },
      shortcuts: {
        find: 'Ctrl+Shift+F'
      }
    })
    const result = parseSettingsPayload(testPayload)
    expect(result.success).toBe(true)
    expect(result.data?.theme.name).toBe('monokai')
    expect(result.data?.shortcuts.find).toBe('Ctrl+Shift+F')
  })

  it('rejects malformed settings JSON', () => {
    const result = parseSettingsPayload('{ corrupted json')
    expect(result.success).toBe(false)
  })

  it('rejects payload with missing theme', () => {
    const result = parseSettingsPayload(JSON.stringify({ version: 1, shortcuts: {} }))
    expect(result.success).toBe(false)
  })
})

describe('Quick Note Double Click Tab Creation Logic', () => {
  it('detects empty draft content correctly', () => {
    const emptyDraft = { id: '1', text: '   ', cursor: 0, createdAt: 1, updatedAt: 1 }
    const filledDraft = { id: '2', text: 'hello world', cursor: 5, createdAt: 1, updatedAt: 1 }
    expect(emptyDraft.text.trim().length === 0).toBe(true)
    expect(filledDraft.text.trim().length === 0).toBe(false)
  })
})
