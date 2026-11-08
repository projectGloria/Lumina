export interface ShortcutDefinition {
  name: string
  description: string
  defaultKey: string
}

export const DEFAULT_SHORTCUTS: Record<string, ShortcutDefinition> = {
  newDraft: { name: 'New Note', description: 'Create a new blank note draft', defaultKey: 'Ctrl+N' },
  open: { name: 'Open File', description: 'Open an existing file in a new tab', defaultKey: 'Ctrl+O' },
  save: { name: 'Save', description: 'Write the current file to disk, or ask where to put a new note', defaultKey: 'Ctrl+S' },
  saveAs: { name: 'Save As…', description: 'Save the current tab under a new name', defaultKey: 'Ctrl+Shift+S' },
  find: { name: 'Find in Note', description: 'Open Find & Replace bar', defaultKey: 'Ctrl+F' },
  replace: { name: 'Replace', description: 'Open Replace field', defaultKey: 'Ctrl+H' },
  closeTab: { name: 'Close Note', description: 'Close active note draft', defaultKey: 'Ctrl+W' },
  closeWindow: { name: 'Close Window', description: 'Close Lumina Quick Note window', defaultKey: 'Ctrl+Shift+W' },
  undo: { name: 'Undo', description: 'Undo last editor change', defaultKey: 'Ctrl+Z' },
  redo: { name: 'Redo', description: 'Redo previously undone change', defaultKey: 'Ctrl+Y' },
  duplicateLine: { name: 'Duplicate Line', description: 'Duplicate current line below', defaultKey: 'Ctrl+D' },
  nextTab: { name: 'Next Note', description: 'Switch to next note tab', defaultKey: 'Ctrl+PageDown' },
  prevTab: { name: 'Previous Note', description: 'Switch to previous note tab', defaultKey: 'Ctrl+PageUp' },
  openTheme: { name: 'Theme Editor', description: 'Open Theme & Font Customizer', defaultKey: 'Ctrl+Alt+T' },
  openShortcuts: { name: 'Shortcut Editor', description: 'Open Keyboard Shortcuts Editor', defaultKey: 'Ctrl+Alt+K' },
  toggleReadMode: { name: 'Toggle Read Mode', description: 'Toggle Markdown preview / read mode', defaultKey: 'Ctrl+E' }
}

export interface KeyPressLike {
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  key: string
}

export function formatKeyCombination(e: KeyPressLike): string | null {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return null

  let normalized = k
  if (k.length === 1) {
    normalized = k.toUpperCase()
  } else if (k === 'PageDown') {
    normalized = 'PageDown'
  } else if (k === 'PageUp') {
    normalized = 'PageUp'
  } else if (k === 'Escape') {
    normalized = 'Esc'
  }

  parts.push(normalized)
  return parts.join('+')
}

export function matchesShortcut(event: KeyPressLike, shortcutStr: string): boolean {
  if (!shortcutStr) return false
  const parts = shortcutStr.split('+').map((p) => p.trim().toLowerCase())

  const needsCtrl = parts.includes('ctrl')
  const needsAlt = parts.includes('alt')
  const needsShift = parts.includes('shift')

  const keyPart = parts.find((p) => !['ctrl', 'alt', 'shift'].includes(p))
  if (!keyPart) return false

  const hasCtrl = Boolean(event.ctrlKey || event.metaKey)
  const hasAlt = Boolean(event.altKey)
  const hasShift = Boolean(event.shiftKey)

  if (needsCtrl !== hasCtrl) return false
  if (needsAlt !== hasAlt) return false
  if (needsShift !== hasShift) return false

  const eventKey = event.key.toLowerCase()
  if (keyPart === 'esc' && eventKey === 'escape') return true
  return eventKey === keyPart
}
