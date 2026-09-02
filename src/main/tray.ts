/**
 * The tray icon, which is what keeps Lumina reachable with no window open.
 *
 * Deliberately thin: a tray-only Lumina is the main process, an icon and a
 * global shortcut, with no BrowserWindow and no vault indexed until something
 * actually asks for one.
 */
import path from 'node:path'
import { app, Menu, Tray, nativeImage } from 'electron'

export interface TrayHandlers {
  quickNote: () => void
  show: () => void
  quit: () => void
}

let tray: Tray | null = null

function iconPath(): string {
  // `extraResources` in electron-builder.yml puts the icon beside the app in a
  // packaged build; in development it is still in the repo.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'resources', 'icon.ico')
}

export function ensureTray(handlers: TrayHandlers, accelerator: string): void {
  if (tray) {
    tray.setContextMenu(buildMenu(handlers, accelerator))
    return
  }

  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('Lumina')
  tray.setContextMenu(buildMenu(handlers, accelerator))
  // Windows and Linux only; on macOS a click opens the menu instead.
  tray.on('click', handlers.show)
}

function buildMenu(handlers: TrayHandlers, accelerator: string): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'New note',
      // Display only: the accelerator is bound globally, not by this menu.
      accelerator: accelerator || undefined,
      registerAccelerator: false,
      click: handlers.quickNote
    },
    { label: 'Open Lumina', click: handlers.show },
    { type: 'separator' },
    { label: 'Quit Lumina', click: handlers.quit }
  ])
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export const hasTray = (): boolean => tray !== null
