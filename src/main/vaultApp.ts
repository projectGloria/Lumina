import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import { CH } from '@shared/channels'
import type { QuickNoteSettings, Settings } from '@shared/types'
import {
  flushRenderer,
  onSettingsChanged,
  openFileFromDisk,
  pushQuickNote,
  registerIpc,
  reportQuickNoteStatus,
  setClipArrivedHandler,
  setMainWindow,
  syncClipServer,
  teardown
} from './ipc'
import { stopClipServer } from './clipServer'
import { stopWhisperServer } from './whisperServer'
import { saveCache } from './indexer'
import { fileArgsFrom } from './paths'
import { setMusicRoot } from './music'
import { handleProtocol, registerScheme } from './protocol'
import {
  applyLoginItem,
  bindQuickNoteShortcut,
  DEFAULT_QUICK_NOTE,
  HIDDEN_FLAG,
  releaseQuickNoteShortcut
} from './quickNote'
import { loadAppState } from './settings'
import { destroyTray, ensureTray } from './tray'
import { getRoot } from './vault'
import { createWindow, updateTitleBarOverlay, type Bounds } from './window'

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
  let windowBounds: Bounds | undefined
  let quickNote: QuickNoteSettings = DEFAULT_QUICK_NOTE

  /**
   * Started by the OS at login (see `applyLoginItem`), which means the tray and
   * the global shortcut, but no window and no vault until something asks for
   * one — the cheap idle state the quick note depends on.
   */
  const startedHidden = process.argv.includes(HIDDEN_FLAG)

  // Set only by the tray's Quit and by a plain window close when the app is not
  // meant to outlive it; every other close just hides.
  let allowQuit = false

  /**
   * Closing the window destroys the renderer, taking any unsaved buffer with
   * it, so hold the close open until the renderer has written everything out.
   * Every window goes through here, including one macOS recreates on activate.
   */
  function attach(win: BrowserWindow): void {
    let flushed = false
    win.on('close', (event) => {
      // Hiding to the tray keeps the renderer (and its buffers) alive, but the
      // flush still runs: the window may not come back before the machine does.
      if (quickNote.closeToTray && !allowQuit) {
        event.preventDefault()
        void flushRenderer().finally(() => {
          if (!win.isDestroyed()) win.hide()
        })
        return
      }
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

  /** The window, built on demand — there may not be one when starting hidden. */
  function ensureWindow(show: boolean): BrowserWindow {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

    const win = createWindow(windowBounds, nativeTheme.shouldUseDarkColors, { show })
    mainWindow = win
    setMainWindow(win)
    attach(win)

    // Wait for the renderer to be listening before pushing it a vault.
    win.webContents.once('did-finish-load', () => {
      acceptingFiles = true
      draining = draining.then(drainFiles).catch(() => {})
      // Beyond a file argument, which vault opens is the profile picker's call
      // — see `profiles.ts` and the renderer's `ProfilePicker`.
    })
    return win
  }

  function showWindow(): void {
    const win = ensureWindow(true)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  /**
   * The global shortcut, and the tray's New note.
   *
   * The window is brought up first and the request queued in `ipc.ts`, which
   * holds it until the renderer drains it on mount. A press against a cold
   * tray therefore still produces exactly one note, however long the window
   * takes to appear — and two presses produce two.
   */
  function triggerQuickNote(): void {
    showWindow()
    pushQuickNote()
  }

  function quitFromTray(): void {
    allowQuit = true
    app.quit()
  }

  /**
   * Re-apply the parts of the quick-note preferences that live outside the
   * renderer. Called at startup and again after every settings save, since the
   * accelerator, the tray and the login item can all change from the UI.
   */
  function applyQuickNote(next: QuickNoteSettings, announce: boolean): void {
    quickNote = next
    const registered = bindQuickNoteShortcut(next.accelerator, triggerQuickNote)
    if (announce && !registered) reportQuickNoteStatus(next.accelerator, false)

    // The tray is what lets the app outlive its window, so it is wanted
    // whenever either of those preferences is on — or when we started with no
    // window at all and it is the only way back in.
    if (next.closeToTray || next.startAtLogin || startedHidden) {
      ensureTray(
        { quickNote: triggerQuickNote, show: showWindow, quit: quitFromTray },
        next.accelerator
      )
    } else {
      destroyTray()
    }

    applyLoginItem(next.startAtLogin)
    if (next.preloadWindow) ensureWindow(false)
  }

  queueFiles(fileArgsFrom(process.argv, app.isPackaged))

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
    windowBounds = state.windowBounds

    // Where the music is, so `lumina://music/...` can answer. Setting a string
    // costs nothing; the folder itself is not read until the player asks for
    // it, which must never be on the path that brings the app up into the tray.
    setMusicRoot(state.music.folder)

    registerIpc()
    onSettingsChanged((settings: Settings) => applyQuickNote(settings.quickNote, true))

    // The clip listener is app-level, so it comes up here rather than when a
    // vault opens: the extension should reach Lumina whenever Lumina is
    // running, including on the profile picker and from the tray. A clip that
    // arrives before a vault is open waits in the renderer.
    void syncClipServer(state.clipper)

    // A clip can land while Lumina is idling in the tray with no window, so
    // one has to exist for the renderer to write the note. Deliberately
    // `ensureWindow(false)` rather than `showWindow()`: the user is in their
    // browser and clipping is meant to be something they barely notice. The
    // clip itself is already queued in `ipc.ts` and drains on mount.
    setClipArrivedHandler(() => {
      ensureWindow(false)
    })

    // A file on the command line is a request for a window, whatever the login
    // item asked for.
    if (!startedHidden || pendingFiles.length) ensureWindow(true)
    applyQuickNote(state.quickNote, false)

    ipcMain.on(CH.winMaximizeChanged, () => {
      /* renderer-initiated no-op, kept so the channel is symmetrical */
    })

    ipcMain.handle('win:setOverlay', (_e, bg: string, symbol: string) => {
      if (mainWindow) updateTitleBarOverlay(mainWindow, bg, symbol)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showWindow()
    })
  })

  app.on('window-all-closed', () => {
    // With close-to-tray on, the window hides rather than closing, so getting
    // here means the user really did close it.
    if (process.platform !== 'darwin' && !quickNote.closeToTray) app.quit()
  })

  // Quitting without closing the window first (Cmd+Q, the tray's Quit) skips
  // the close handler, so the flush has to happen here too. Both paths are
  // idempotent: saving a buffer that is already clean does nothing.
  let quitting = false
  app.on('before-quit', async (event) => {
    allowQuit = true
    if (quitting) return
    releaseQuickNoteShortcut()
    destroyTray()
    void stopClipServer()
    void stopWhisperServer()
    if (!getRoot()) return
    event.preventDefault()
    quitting = true
    await flushRenderer().catch(() => {})
    await saveCache().catch(() => {})
    await teardown()
    app.exit(0)
  })
}
