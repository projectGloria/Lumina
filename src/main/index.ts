import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import { CH } from '@shared/channels'
import { openVault, registerIpc, setMainWindow, teardown } from './ipc'
import { saveCache } from './indexer'
import { handleProtocol, registerScheme } from './protocol'
import { loadAppState } from './settings'
import { getRoot } from './vault'
import { createWindow, updateTitleBarOverlay } from './window'

// Must run before the app is ready, so the scheme counts as privileged.
registerScheme()

// Only one Lumina at a time: a second copy would fight over the same vault.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
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

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // Reopen the last vault once the renderer is listening for the payload.
    mainWindow.webContents.once('did-finish-load', () => {
      if (state.lastVault) {
        void openVault(state.lastVault).catch(() => {
          // Folder moved or deleted; the renderer falls back to the welcome screen.
        })
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow(state.windowBounds, nativeTheme.shouldUseDarkColors)
        setMainWindow(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', async (event) => {
    if (!getRoot()) return
    event.preventDefault()
    await saveCache().catch(() => {})
    await teardown()
    app.exit(0)
  })
}
