import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionCache } from './cache'
import { getSystemFonts } from './fonts'
import { parseSession, type Draft } from '../../shared/quicknoteSession'
import { quickNoteName } from '../../shared/quickNote'
import { writeChosenNote } from '../noteWriter'
import { createQuickNoteDesktopShortcut } from './shortcut'

export function startQuickNote(): void {
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  let win: BrowserWindow | null = null
  let tray: Tray | null = null
  let isQuitting = false
  let closing = false
  let permitted = false
  let token = 0
  let pending: { token: number; resolve: () => void; reject: (e: Error) => void } | undefined
  const cache = new SessionCache(path.join(app.getPath('userData'), 'quicknote-cache', 'session.json'))
  let saving: Promise<unknown> = Promise.resolve()
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame

  function ensureTray(): void {
    if (tray) return
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'quicknote-icon.ico')
      : path.join(app.getAppPath(), 'resources', 'quicknote-icon.ico')
    const img = nativeImage.createFromPath(iconPath)
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
    tray.setToolTip('Lumina Quick Note')
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Quick Note', click: () => show() },
      {
        label: 'New Note',
        click: () => {
          show()
          win?.webContents.send('qn:new')
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Quick Note',
        click: () => {
          isQuitting = true
          if (tray) {
            tray.destroy()
            tray = null
          }
          app.quit()
        }
      }
    ])
    tray.setContextMenu(contextMenu)
    tray.on('click', () => {
      if (win && win.isVisible() && !win.isMinimized()) {
        win.focus()
      } else {
        show()
      }
    })
  }

  async function closeWindow(forceQuit = false): Promise<void> {
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
      if (!isQuitting && !forceQuit) {
        target.hide()
      } else {
        permitted = true
        target.close()
      }
    } catch (error) {
      const choice = await dialog.showMessageBox(target, {
        type: 'warning', message: 'Your latest changes may not be saved.',
        detail: String(error), buttons: ['Retry', 'Keep Open', 'Close Anyway'],
        defaultId: 0, cancelId: 1
      })
      retry = choice.response === 0
      if (choice.response === 2) {
        if (!isQuitting && !forceQuit) {
          target.hide()
        } else {
          permitted = true
          target.close()
        }
      }
    } finally { pending = undefined; closing = false }
    if (retry) void closeWindow(forceQuit)
  }

  const show = (): void => {
    ensureTray()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }
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
    const target = win
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    target.webContents.on('will-navigate', (event) => event.preventDefault())
    target.on('close', (event) => {
      if (!permitted && !isQuitting) {
        event.preventDefault()
        void closeWindow(false)
      }
    })
    target.on('closed', () => { win = null })
    const url = process.env.ELECTRON_RENDERER_URL
    if (url) void target.loadURL(url + '/quicknote/index.html')
    else void target.loadFile(path.join(__dirname, '../renderer/quicknote/index.html'))
  }
  app.on('second-instance', () => { if (app.isReady()) show() })
  app.on('before-quit', (event) => {
    isQuitting = true
    if (win && !permitted) { event.preventDefault(); void closeWindow(true) }
  })
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit()
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    ipcMain.handle('qn:load', (event) => { if (!trusted(event)) throw new Error('Invalid sender'); return cache.load() })
    ipcMain.handle('qn:persist', (event, session) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      return cache.write(session)
    })
    ipcMain.handle('qn:save', (event, draft: Draft) => {
      if (!trusted(event)) throw new Error('Invalid sender')
      parseSession({ version: 1, buffers: [draft] })
      const operation = saving.catch(() => {}).then(async () => {
        if (!win) throw new Error('Window closed')
        const choice = await dialog.showSaveDialog(win, {
          title: 'Save Quick Note As', defaultPath: quickNoteName() + '.md',
          filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
          properties: ['showOverwriteConfirmation', 'createDirectory']
        })
        if (choice.canceled || !choice.filePath) return null
        await writeChosenNote(choice.filePath, draft.text)
        return choice.filePath
      })
      saving = operation
      return operation
    })
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
