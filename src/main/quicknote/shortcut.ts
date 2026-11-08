import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { QUICKNOTE_NAME } from '@shared/appNames'

export interface ShortcutResult {
  ok: boolean
  path?: string
  error?: string
}

const AUMID = 'com.nihil.lumina.quicknote'
const LINK_NAME = `${QUICKNOTE_NAME}.lnk`
// Shipped before the rename. Cleaned up only when it provably points at us —
// "Quick Note.lnk" is generic enough that another app could own one.
const LEGACY_LINK_NAME = 'Quick Note.lnk'
// Built by scripts/build-quicknote-launcher.ps1, installed beside Lumina.exe.
const LAUNCHER_EXE = `${QUICKNOTE_NAME}.exe`

interface LinkTarget {
  target: string
  args: string
  cwd: string
  icon: string
}

/**
 * What a Quick Note shortcut should launch. Prefers the launcher exe so the
 * shortcut is the same app Windows lists under "Open with"; falls back to
 * `Lumina.exe --quicknote` when there is no launcher (dev runs, `build:dir`
 * without the stub). In dev, an installed copy wins over the dev Electron so a
 * shortcut made while hacking still works after the dev server stops.
 */
function resolveLinkTarget(): LinkTarget {
  const devIcon = path.join(app.getAppPath(), 'resources', 'quicknote-icon.ico')
  const fromInstallDir = (dir: string, fallbackIcon: string): LinkTarget => {
    const launcher = path.join(dir, LAUNCHER_EXE)
    const icon = path.join(dir, 'resources', 'quicknote-icon.ico')
    const iconPath = fs.existsSync(icon) ? icon : fallbackIcon
    return fs.existsSync(launcher)
      ? { target: launcher, args: '', cwd: dir, icon: iconPath }
      : { target: path.join(dir, 'Lumina.exe'), args: '--quicknote', cwd: dir, icon: iconPath }
  }

  if (app.isPackaged) {
    return fromInstallDir(path.dirname(process.execPath), path.join(process.resourcesPath, 'quicknote-icon.ico'))
  }

  const installedExe = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Lumina', 'Lumina.exe')
    : null
  if (installedExe && fs.existsSync(installedExe)) return fromInstallDir(path.dirname(installedExe), devIcon)

  // Pure dev: the Electron binary needs the app path before the flag.
  return {
    target: process.execPath,
    args: `"${app.getAppPath()}" --quicknote`,
    cwd: path.dirname(process.execPath),
    icon: devIcon
  }
}

function writeLink(linkPath: string, t: LinkTarget): boolean {
  return shell.writeShortcutLink(linkPath, fs.existsSync(linkPath) ? 'replace' : 'create', {
    target: t.target,
    args: t.args,
    cwd: t.cwd,
    icon: t.icon,
    iconIndex: 0,
    description: QUICKNOTE_NAME,
    appUserModelId: AUMID
  })
}

/** Removes the pre-rename shortcut in `dir`, but only if it launches Lumina. */
function removeLegacyLink(dir: string): void {
  const legacy = path.join(dir, LEGACY_LINK_NAME)
  try {
    if (!fs.existsSync(legacy)) return
    // readShortcutLink throws on a malformed .lnk; that also means "not ours".
    const target = path.basename(shell.readShortcutLink(legacy).target).toLowerCase()
    if (target === 'lumina.exe' || target === LAUNCHER_EXE.toLowerCase()) fs.unlinkSync(legacy)
  } catch {
    // Leave anything we can't positively identify alone.
  }
}

function startMenuDir(): string {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
}

export function createQuickNoteDesktopShortcut(): Promise<ShortcutResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Shortcuts are only supported on Windows.' })
      return
    }

    try {
      const t = resolveLinkTarget()
      const desktop = app.getPath('desktop')
      const shortcutPath = path.join(desktop, LINK_NAME)
      removeLegacyLink(desktop)
      const success = writeLink(shortcutPath, t)

      // Also create or update in Start Menu Programs so Windows Search indexes it
      try {
        removeLegacyLink(startMenuDir())
        writeLink(path.join(startMenuDir(), LINK_NAME), t)
      } catch {
        // Start Menu is optional
      }

      if (success) {
        resolve({ ok: true, path: shortcutPath })
        return
      }

      // Fallback via PowerShell WScript.Shell COM
      const q = (s: string): string => s.replace(/'/g, "''")
      const script = `
        $ws = New-Object -ComObject WScript.Shell
        $s = $ws.CreateShortcut('${q(shortcutPath)}')
        $s.TargetPath = '${q(t.target)}'
        $s.Arguments = '${q(t.args)}'
        $s.WorkingDirectory = '${q(t.cwd)}'
        $s.IconLocation = '${q(t.icon)},0'
        $s.Description = '${q(QUICKNOTE_NAME)}'
        $s.Save()
      `
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (err) => {
        if (err) resolve({ ok: false, error: err.message })
        else resolve({ ok: true, path: shortcutPath })
      })
    } catch (err) {
      resolve({ ok: false, error: String(err) })
    }
  })
}

export function ensureQuickNoteStartMenuShortcut(): void {
  if (process.platform !== 'win32') return
  try {
    removeLegacyLink(startMenuDir())
    writeLink(path.join(startMenuDir(), LINK_NAME), resolveLinkTarget())
  } catch {
    // Non-fatal
  }
}
