import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

export interface ShortcutResult {
  ok: boolean
  path?: string
  error?: string
}

export function createQuickNoteDesktopShortcut(): Promise<ShortcutResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Shortcuts are only supported on Windows.' })
      return
    }

    try {
      let target = process.execPath
      let args = '--quicknote'
      let cwd = path.dirname(target)
      let iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'quicknote-icon.ico')
        : path.join(app.getAppPath(), 'resources', 'quicknote-icon.ico')

      const installedExe = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Lumina', 'Lumina.exe')
        : null

      if (!app.isPackaged && installedExe && fs.existsSync(installedExe)) {
        target = installedExe
        cwd = path.dirname(installedExe)
        const installedIcon = path.join(cwd, 'resources', 'quicknote-icon.ico')
        if (fs.existsSync(installedIcon)) iconPath = installedIcon
      } else if (!app.isPackaged && (!installedExe || !fs.existsSync(installedExe))) {
        args = `"${app.getAppPath()}" --quicknote`
      }

      const desktop = app.getPath('desktop')
      const shortcutPath = path.join(desktop, 'Quick Note.lnk')
      const op = fs.existsSync(shortcutPath) ? 'replace' : 'create'

      const success = shell.writeShortcutLink(shortcutPath, op, {
        target,
        args,
        cwd,
        icon: iconPath,
        iconIndex: 0,
        description: 'Lumina Quick Note',
        appUserModelId: 'com.nihil.lumina.quicknote'
      })

      // Also create or update in Start Menu Programs so Windows Search indexes it
      try {
        const appData = app.getPath('appData')
        const startMenuPath = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Quick Note.lnk')
        const startOp = fs.existsSync(startMenuPath) ? 'replace' : 'create'
        shell.writeShortcutLink(startMenuPath, startOp, {
          target,
          args,
          cwd,
          icon: iconPath,
          iconIndex: 0,
          description: 'Lumina Quick Note',
          appUserModelId: 'com.nihil.lumina.quicknote'
        })
      } catch {
        // Start Menu is optional
      }

      if (success) {
        resolve({ ok: true, path: shortcutPath })
        return
      }

      // Fallback via PowerShell WScript.Shell COM
      const script = `
        $ws = New-Object -ComObject WScript.Shell
        $s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
        $s.TargetPath = '${target.replace(/'/g, "''")}'
        $s.Arguments = '${args.replace(/'/g, "''")}'
        $s.WorkingDirectory = '${cwd.replace(/'/g, "''")}'
        $s.IconLocation = '${iconPath.replace(/'/g, "''")},0'
        $s.Description = 'Lumina Quick Note'
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
