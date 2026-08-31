/**
 * Accelerator strings like `Ctrl+Shift+P` and how they map to key events.
 *
 * Commands carry a default accelerator; the user's overrides live in
 * `settings.hotkeys` keyed by command id, so nothing here is hardcoded to a
 * particular binding.
 */

const ALIASES: Record<string, string> = {
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  esc: 'escape',
  space: ' ',
  plus: '+',
  return: 'enter'
}

export interface ParsedAccelerator {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

export function parseAccelerator(accel: string): ParsedAccelerator | null {
  if (!accel) return null
  // Split on `+` but keep a trailing literal `+` as the key.
  const parts = accel
    .replace(/\+\+$/, '+plus')
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (!parts.length) return null

  const key = parts.pop()!
  const mods = new Set(parts)
  return {
    ctrl: mods.has('ctrl') || mods.has('control') || mods.has('mod') || mods.has('cmdorctrl'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
    meta: mods.has('meta') || mods.has('cmd') || mods.has('super'),
    key: ALIASES[key] ?? key
  }
}

export function matchesAccelerator(e: KeyboardEvent, accel: string): boolean {
  const parsed = parseAccelerator(accel)
  if (!parsed) return false
  if (e.ctrlKey !== parsed.ctrl) return false
  if (e.shiftKey !== parsed.shift) return false
  if (e.altKey !== parsed.alt) return false
  if (e.metaKey !== parsed.meta) return false

  const key = e.key.toLowerCase()
  if (key === parsed.key) return true
  // `Ctrl+Shift+\` reports different keys across layouts; fall back to code.
  return e.code.toLowerCase() === `key${parsed.key}` || e.code.toLowerCase() === parsed.key
}

const CM_KEY_NAMES: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown'
}

/**
 * Translate an accelerator like `Ctrl+Shift+H` into a CodeMirror keymap key
 * like `Mod-Shift-h`, so the editor's own keymap can be built from the same
 * `Command` registry instead of a second, hardcoded list.
 */
export function translateAccelerator(accel: string): string | null {
  const parsed = parseAccelerator(accel)
  if (!parsed) return null

  const parts: string[] = []
  if (parsed.ctrl || parsed.meta) parts.push('Mod')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  parts.push(CM_KEY_NAMES[parsed.key] ?? parsed.key)
  return parts.join('-')
}

const DISPLAY: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  mod: 'Ctrl',
  cmdorctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Win',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  escape: 'Esc',
  enter: 'Enter',
  backspace: 'Backspace',
  tab: 'Tab',
  ' ': 'Space'
}

/** Split an accelerator into chips for rendering next to a command. */
export function acceleratorChips(accel: string): string[] {
  if (!accel) return []
  return accel
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lower = p.toLowerCase()
      return DISPLAY[ALIASES[lower] ?? lower] ?? (p.length === 1 ? p.toUpperCase() : p)
    })
}

/** Build an accelerator string from a keydown, for the hotkey recorder. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const key = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Meta')

  const named: Record<string, string> = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ' ': 'Space',
    Escape: 'Esc'
  }
  parts.push(named[key] ?? (key.length === 1 ? key.toUpperCase() : key))

  // A bare letter is not a usable global shortcut.
  if (parts.length === 1 && /^[A-Za-z0-9]$/.test(parts[0])) return null
  return parts.join('+')
}
