import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { CH } from '@shared/channels'
import { saveAppState } from './settings'

/** Matches `--lum-bg` in the light theme, so the window never flashes white. */
const LIGHT_BG = '#faf9f5'
const DARK_BG = '#262624'

export interface Bounds {
  width: number
  height: number
  x?: number
  y?: number
}

export function createWindow(bounds: Bounds | undefined, dark: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: dark ? DARK_BG : LIGHT_BG,
    // Frameless with the native controls drawn into our own title bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? DARK_BG : LIGHT_BG,
      symbolColor: dark ? '#f5f4ef' : '#141413',
      height: 38
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => win.show())

  const pushMaximize = (): void =>
    win.webContents.send(CH.winMaximizeChanged, win.isMaximized())
  win.on('maximize', pushMaximize)
  win.on('unmaximize', pushMaximize)

  // Remember where the user left the window.
  let saveTimer: NodeJS.Timeout | null = null
  const rememberBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (win.isDestroyed() || win.isMinimized()) return
      const b = win.getNormalBounds()
      void saveAppState({ windowBounds: { width: b.width, height: b.height, x: b.x, y: b.y } })
    }, 500)
  }
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)

  // External links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  // In development, renderer logs and errors go to the terminal running the
  // dev server, so a failure in the editor is visible without opening devtools.
  if (devUrl) {
    win.webContents.on(
      'console-message',
      (...args: unknown[]) => {
        // Electron changed this signature across majors; accept either shape.
        const first = args[1]
        const detail =
          typeof first === 'object' && first !== null
            ? (first as { message?: string }).message
            : (args[2] as string | undefined)
        if (detail) console.log(`[renderer] ${detail}`)
      }
    )
    win.webContents.on('render-process-gone', (_e, details) =>
      console.error('[renderer] gone:', details.reason)
    )
  }

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))

  return win
}

/** Recolour the native window buttons when the theme changes. */
export function updateTitleBarOverlay(win: BrowserWindow, bg: string, symbol: string): void {
  if (win.isDestroyed()) return
  try {
    win.setTitleBarOverlay({ color: bg, symbolColor: symbol, height: 38 })
    win.setBackgroundColor(bg)
  } catch {
    // Not supported on every platform; the custom bar still renders.
  }
}
