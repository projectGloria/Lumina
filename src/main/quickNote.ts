/**
 * The OS-wide quick note: one global accelerator, plus the login-item and
 * tray preferences that decide whether it works when no window is open.
 *
 * Nothing here creates the note — that is the renderer's job (`createQuickNote`
 * in `lib/actions.ts`), because naming and opening a note in a tab is the same
 * work the rest of the app already does. This module only decides *when* to
 * ask for one.
 */
import { app, globalShortcut } from 'electron'
import type { QuickNoteSettings } from '@shared/types'

export const DEFAULT_QUICK_NOTE: QuickNoteSettings = {
  // Electron matches either Ctrl and either Shift; it cannot distinguish the
  // left-hand keys on their own.
  accelerator: 'Control+Shift+Space',
  folder: 'Temporary',
  // On by default: an instant note that only works while Lumina happens to be
  // running is not the feature. Both are one toggle away in Settings.
  startAtLogin: true,
  closeToTray: true,
  // Off by default — idling in the tray should stay cheap. Turning it on keeps
  // a hidden window warm so even the first press opens instantly.
  preloadWindow: false
}

/** Argument Lumina passes itself when the OS starts it at login. */
export const HIDDEN_FLAG = '--hidden'

let registered = ''

/**
 * Point the global shortcut at `accelerator`, replacing whatever was bound
 * before. Returns false when the OS refused it — usually another app already
 * owns the combination — leaving nothing bound rather than the old key.
 */
export function bindQuickNoteShortcut(accelerator: string, onTrigger: () => void): boolean {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = ''
  }
  const wanted = accelerator.trim()
  if (!wanted) return true

  try {
    if (!globalShortcut.register(wanted, onTrigger)) return false
  } catch {
    // Electron throws on a malformed accelerator rather than returning false.
    return false
  }
  registered = wanted
  return true
}

export function releaseQuickNoteShortcut(): void {
  globalShortcut.unregisterAll()
  registered = ''
}

/**
 * Keep the OS login item in step with the preference.
 *
 * The login entry carries `--hidden`, which `index.ts` reads to boot into the
 * tray without a window — starting the whole UI on every login would be a poor
 * trade for a shortcut you might press twice a day.
 */
export function applyLoginItem(startAtLogin: boolean): void {
  // Linux has no login-item API in Electron, and dev runs would register the
  // electron binary rather than Lumina.
  if (process.platform === 'linux' || !app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: startAtLogin, args: [HIDDEN_FLAG] })
}
