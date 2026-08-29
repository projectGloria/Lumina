import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import { CH } from '@shared/channels'
import { flushRenderer, openFileFromDisk, openVault, registerIpc, setMainWindow, teardown } from './ipc'
import { saveCache } from './indexer'
import { fileArgsFrom } from './paths'
import { handleProtocol, registerScheme } from './protocol'
import { loadAppState } from './settings'
import { getRoot } from './vault'
import { createWindow, updateTitleBarOverlay } from './window'

// Must run before the app is ready, so the scheme counts as privileged.
registerScheme()

/**
 * Notes the OS wants opened, waiting for a window to show them in.
 *
 * A double-click can reach us before the renderer exists (cold start), while
 * the app is already running (`second-instance` on Windows and Linux,
 * `open-file` on macOS), or several at once. Queueing keeps all three paths on
 * the same code, and draining is serial so two files never race to open two
 * different vaults.
 */
const pendingFiles: string[] = []
let acceptingFiles = false
let draining: Promise<void> = Promise.resolve()

function queueFiles(files: string[]): void {
  for (const file of files) if (!pendingFiles.includes(file)) pendingFiles.push(file)
  if (acceptingFiles) draining = draining.then(drainFiles)
}

async function drainFiles(): Promise<void> {
  while (pendingFiles.length) {
    const next = pendingFiles.shift() as string
    try {
      await openFileFromDisk(next)
    } catch {
      // A note that will not open is not worth failing the launch over.
    }
  }
}

// macOS delivers file arguments as an event, and only if we are listening
// before the app is ready.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  queueFiles([filePath])
})

// Only one Lumina at a time: a second copy would fight over the same vault.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  queueFiles(fileArgsFrom(process.argv, app.isPackaged))

  /**
   * Closing the window destroys the renderer, taking any unsaved buffer with
   * it, so hold the close open until the renderer has written everything out.
   * Every window goes through here, including one macOS recreates on activate.
   */
  function attach(win: BrowserWindow): void {
    let flushed = false
    win.on('close', (event) => {
      if (flushed) return
      event.preventDefault()
      flushed = true
      void flushRenderer().finally(() => {
        if (!win.isDestroyed()) win.close()
      })
    })
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null
    })
  }

  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // Double-clicking a note while Lumina is running launches a second copy,
    // which hands its arguments to us and exits.
    queueFiles(fileArgsFrom(argv, app.isPackaged))
  })

  app.whenReady().then(async () => {
    // The custom title bar replaces the menu entirely; shortcuts live in the
    // renderer's command registry so they can be rebound.
    Menu.setApplicationMenu(null)
    handleProtocol()

    const state = await loadAppState()
    const dark = nativeTheme.shouldUseDarkColors

    mainWindow = createWindow(state.windowBounds, dark)
    setMainWindow(mainWindow)
    registerIpc()

    ipcMain.on(CH.winMaximizeChanged, () => {
      /* renderer-initiated no-op, kept so the channel is symmetrical */
    })

    ipcMain.handle('win:setOverlay', (_e, bg: string, symbol: string) => {
      if (mainWindow) updateTitleBarOverlay(mainWindow, bg, symbol)
    })

    attach(mainWindow)

    // Wait for the renderer to be listening before pushing it a vault.
    mainWindow.webContents.once('did-finish-load', () => {
      acceptingFiles = true
      draining = draining
        .then(drainFiles)
        .then(async () => {
          // Nothing was opened from a file argument, so resume where the user
          // left off. A file that did resolve has already chosen its vault.
          if (!getRoot() && state.lastVault) {
            await openVault(state.lastVault).catch(() => {
              // Folder moved or deleted; the renderer falls back to the welcome screen.
            })
          }
        })
        .catch(() => {})
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow(state.windowBounds, nativeTheme.shouldUseDarkColors)
        setMainWindow(mainWindow)
        attach(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Quitting without closing the window first (Cmd+Q) skips the close handler,
  // so the flush has to happen here too. Both paths are idempotent: saving a
  // buffer that is already clean does nothing.
  let quitting = false
  app.on('before-quit', async (event) => {
    if (quitting || !getRoot()) return
    event.preventDefault()
    quitting = true
    await flushRenderer().catch(() => {})
    await saveCache().catch(() => {})
    await teardown()
    app.exit(0)
  })
}
