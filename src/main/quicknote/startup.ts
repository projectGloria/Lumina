import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { samePath } from '../paths'
import { SessionCache } from './cache'
import { getSystemFonts } from './fonts'
import { readDocuments, writeDocument } from './files'
import {
  parseSession,
  type Draft,
  type Session,
  type FileOpenResult,
  type FileSaveResult
} from '@shared/quicknoteSession'
import { TEXT_EXTENSIONS } from '@shared/textFiles'
import { quickNoteName } from '@shared/quickNote'
import { documentArgsFrom } from '../fileRoute'
import { createQuickNoteDesktopShortcut, ensureQuickNoteStartMenuShortcut } from './shortcut'

/** Save As and Open offer these, then "All files" for everything else. */
const DIALOG_FILTERS = [
  { name: 'Text documents', extensions: [...TEXT_EXTENSIONS] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
  { name: 'Plain text', extensions: ['txt', 'log'] },
  { name: 'All files', extensions: ['*'] }
]

export function startQuickNote(): void {
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  let win: BrowserWindow | null = null
  let isQuitting = false
  let closing = false
  let permitted = false
  let token = 0
  let pending: { token: number; resolve: () => void; reject: (e: Error) => void } | undefined
  const cache = new SessionCache(path.join(app.getPath('userData'), 'quicknote-cache', 'session.json'))
  let saving: Promise<unknown> = Promise.resolve()
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame

  /**
   * Files the OS wants opened, waiting for a renderer to show them in.
   *
   * Same three arrival paths the Vault app has to cover, for the same reason:
   * a double-click can reach us before the window exists, while we are already
   * running (`second-instance`, or `open-file` on macOS), or several at once.
   * Queueing puts all of them on one code path, and the renderer drains it on
   * mount so a file that arrives against a cold start is never dropped.
   */
  const pendingFiles: string[] = []
  let rendererLive = false

  function queueFiles(files: string[]): void {
    for (const file of files) {
      const abs = path.resolve(file)
      if (!pendingFiles.includes(abs)) pendingFiles.push(abs)
    }
  }

  /** Bring a file up: show the window, then hand it over or queue it. */
  function deliver(files: string[]): void {
    if (!files.length) return
    show()
    if (rendererLive && win) {
      const target = win
      void readDocuments(files.map((file) => path.resolve(file))).then((results) => {
        if (!target.isDestroyed()) target.webContents.send('qn:openFiles', results)
      })
    } else {
      queueFiles(files)
    }
  }

  // macOS delivers file arguments as an event, and only if we are listening
  // before the app is ready — which is why this sits here and not in `whenReady`.
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (app.isReady()) deliver([filePath])
    else queueFiles([filePath])
  })

  async function closeWindow(): Promise<void> {
    if (!win || closing) return
    closing = true
    const target = win
    let retry = false
    try {
      await new Promise<void>((resolve, reject) => {
        const id = ++token
        const timer = setTimeout(() => reject(new Error('Saving took longer than five seconds.')), 5000)
        pending = { token: id, resolve: () => { clearTimeout(timer); resolve() },
          reject: (e) => { clearTimeout(timer); reject(e) } }
        target.webContents.send('qn:flush', id)
      })
      permitted = true
      target.close()
    } catch (error) {
      const choice = await dialog.showMessageBox(target, {
        type: 'warning', message: 'Your latest changes may not be saved.',
        detail: String(error), buttons: ['Retry', 'Keep Open', 'Close Anyway'],
        defaultId: 0, cancelId: 1
      })
      retry = choice.response === 0
      if (choice.response === 2) {
        permitted = true
        target.close()
      }
    } finally { pending = undefined; closing = false }
    if (retry) void closeWindow()
  }

  const show = (): void => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }
    ensureQuickNoteStartMenuShortcut()
    permitted = false
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'quicknote-icon.ico')
      : path.join(app.getAppPath(), 'resources', 'quicknote-icon.ico')
    win = new BrowserWindow({
      title: 'Lumina Quick Note', width: 900, height: 570, minWidth: 360, minHeight: 260,
      icon: iconPath,
      backgroundColor: '#101010', titleBarStyle: 'hidden', titleBarOverlay: { color: '#101010', symbolColor: '#dddddd', height: 30 }, show: true,
      webPreferences: { preload: path.join(__dirname, '../preload/quicknote.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false }
    })

    if (process.platform === 'win32') {
      const relaunchArgs = app.isPackaged ? '--quicknote' : `"${app.getAppPath()}" --quicknote`
      win.setAppDetails({
        appId: 'com.nihil.lumina.quicknote',
        appIconPath: iconPath,
        appIconIndex: 0,
        relaunchCommand: `"${process.execPath}" ${relaunchArgs}`,
        relaunchDisplayName: 'Lumina Quick Note'
      })
    }

    const target = win
    target.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    target.webContents.on('will-navigate', (event, url) => {
      if (url !== target.webContents.getURL()) {
        event.preventDefault()
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      }
    })
    // Only once the renderer is listening can a file be pushed at it; before
    // that everything waits in `pendingFiles` and is drained on mount.
    target.webContents.on('did-finish-load', () => { rendererLive = true })
    target.on('close', (event) => {
      if (!permitted && !isQuitting) {
        event.preventDefault()
        void closeWindow()
      }
    })
    target.on('closed', () => { win = null; rendererLive = false })
    const url = process.env.ELECTRON_RENDERER_URL
    if (url) void target.loadURL(url + '/quicknote/index.html')
    else void target.loadFile(path.join(__dirname, '../renderer/quicknote/index.html'))
  }

  // Double-clicking a file while Quick Note is running launches a second copy,
  // which hands its arguments to us and exits.
  app.on('second-instance', (_event, argv) => {
    if (!app.isReady()) return
    const files = documentArgsFrom(argv, app.isPackaged)
    if (files.length) deliver(files)
    else show()
  })
  app.on('before-quit', (event) => {
    isQuitting = true
    if (win && !permitted) { event.preventDefault(); void closeWindow() }
  })
  app.on('window-all-closed', () => {
    app.quit()
  })

  queueFiles(documentArgsFrom(process.argv, app.isPackaged))

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    let cachedSession: Session | null = null
    ipcMain.handle('qn:load', async (event) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      cachedSession = await cache.load()
      return cachedSession
    })
    ipcMain.handle('qn:persistChanges', async (event, buffers: Draft[], order: string[]) => {
      if (!trusted(event) || !cachedSession) throw new Error('Invalid sender or unloaded cache')
      parseSession({ version: 1, buffers })
      if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) throw new Error('Invalid draft order')
      const drafts = new Map(cachedSession.buffers.map((draft) => [draft.id, draft]))
      for (const draft of buffers) drafts.set(draft.id, draft)
      const next = parseSession({ version: 1, buffers: order.map((id) => drafts.get(id)) })
      cachedSession = next
      await cache.write(next)
    })
    ipcMain.handle('qn:persist', (event, session) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      return cache.write(session)
    })

    /* ------------------------------------------------------------ opening */

    /**
     * Reading a path the renderer names.
     *
     * Quick Note is a text editor, so unlike every filesystem call in the Vault
     * app there is deliberately no vault guard here — the whole feature is
     * editing files that live anywhere. What stands in for it is the `trusted`
     * check on every handler (only our own window's main frame is answered),
     * the sandboxed renderer that has no other way to reach `fs`, and the size
     * and binary refusals in `files.ts`.
     */
    ipcMain.handle('qn:openPaths', (event, paths: unknown): Promise<FileOpenResult[]> => {
      if (!trusted(event)) throw new Error('Invalid sender')
      if (!Array.isArray(paths)) return Promise.resolve([])
      const wanted = paths.filter((p): p is string => typeof p === 'string' && !!p).slice(0, 50)
      return readDocuments(wanted)
    })

    ipcMain.handle('qn:pendingFiles', (event): Promise<FileOpenResult[]> => {
      if (!trusted(event)) throw new Error('Invalid sender')
      return readDocuments(pendingFiles.splice(0, pendingFiles.length))
    })

    ipcMain.handle('qn:openDialog', async (event): Promise<FileOpenResult[]> => {
      if (!trusted(event)) throw new Error('Invalid sender')
      if (!win) return []
      const choice = await dialog.showOpenDialog(win, {
        title: 'Open',
        filters: DIALOG_FILTERS,
        properties: ['openFile', 'multiSelections']
      })
      if (choice.canceled) return []
      return readDocuments(choice.filePaths)
    })

    /* ------------------------------------------------------------- saving */

    /**
     * Save in place, the way an editor does.
     *
     * Serialised behind `saving` along with Save As, so two writes to the same
     * path cannot interleave — the same chain the old single Save As handler
     * used, kept because the two are now reachable in quick succession.
     */
    ipcMain.handle('qn:saveFile', (event, draft: Draft): Promise<FileSaveResult> => {
      if (!trusted(event)) throw new Error('Invalid sender')
      parseSession({ version: 1, buffers: [draft] })
      if (!draft.filePath) {
        return Promise.resolve({ ok: false, error: 'This note has never been saved — use Save As.' })
      }
      const target = draft.filePath
      const operation = saving.catch(() => {}).then(async (): Promise<FileSaveResult> => {
        try {
          await writeDocument(target, draft.text, draft.eol ?? 'lf', draft.encoding ?? 'utf8', draft.bom ?? false, draft.savedText ?? null)
          return { ok: true, path: target }
        } catch (error) {
          return { ok: false, error: (error as Error).message }
        }
      })
      saving = operation
      return operation
    })

    ipcMain.handle('qn:saveAs', (event, draft: Draft): Promise<FileSaveResult> => {
      if (!trusted(event)) throw new Error('Invalid sender')
      parseSession({ version: 1, buffers: [draft] })
      const operation = saving.catch(() => {}).then(async (): Promise<FileSaveResult> => {
        if (!win) return { ok: false, error: 'Window closed' }
        const choice = await dialog.showSaveDialog(win, {
          title: 'Save As',
          // An untitled draft gets a dated note name; an open file offers its
          // own path, so Save As starts in the folder the user is already in.
          defaultPath: draft.filePath ?? quickNoteName() + '.md',
          filters: DIALOG_FILTERS,
          properties: ['showOverwriteConfirmation', 'createDirectory']
        })
        if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true }
        try {
          await writeDocument(
            choice.filePath, draft.text, draft.eol ?? 'lf', draft.encoding ?? 'utf8', draft.bom ?? false,
            draft.filePath && samePath(draft.filePath, choice.filePath) ? draft.savedText ?? null : undefined
          )
          return { ok: true, path: choice.filePath }
        } catch (error) {
          return { ok: false, error: (error as Error).message }
        }
      })
      saving = operation
      return operation
    })

    /* ------------------------------------------------------------- settings */

    ipcMain.handle('qn:exportSettings', async (event, content: string) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      if (!win) return false
      const choice = await dialog.showSaveDialog(win, {
        title: 'Export Quick Note Settings',
        defaultPath: 'quicknote-settings.json',
        filters: [{ name: 'JSON Settings', extensions: ['json'] }]
      })
      if (choice.canceled || !choice.filePath) return false
      await fs.writeFile(choice.filePath, content, 'utf8')
      return true
    })
    ipcMain.handle('qn:importSettings', async (event) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      if (!win) return null
      const choice = await dialog.showOpenDialog(win, {
        title: 'Import Quick Note Settings',
        filters: [{ name: 'JSON Settings', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (choice.canceled || !choice.filePaths.length) return null
      return fs.readFile(choice.filePaths[0], 'utf8')
    })
    ipcMain.handle('qn:getFonts', async (event) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      return getSystemFonts()
    })
    ipcMain.handle('qn:createDesktopShortcut', async (event) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      return createQuickNoteDesktopShortcut()
    })
    ipcMain.on('qn:close', (event) => { if (trusted(event)) void closeWindow() })
    ipcMain.on('qn:flushed', (event, id, error) => {
      if (!trusted(event) || !pending || pending.token !== id) return
      if (error) pending.reject(new Error(String(error)))
      else pending.resolve()
    })
    show()
  })
}
