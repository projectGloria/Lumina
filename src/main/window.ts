import path from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { CH } from '@shared/channels'
import { saveAppState } from './settings'

/**
 * Answer permission prompts ourselves, allowing only the microphone.
 *
 * Electron's default handler approves most requests for a page it considers
 * trusted, which for a voice-note feature is more than we need: this window
 * has no business reaching a camera, a location or a notification, and saying
 * so here means a future dependency cannot quietly acquire one either. Both
 * handlers are needed — Chromium asks `check` for a synchronous capability
 * test (`enumerateDevices` labels) and `request` for the real prompt.
 */
function grantMicrophoneOnly(win: BrowserWindow): void {
  /**
   * The two handlers describe the media type differently, and the difference
   * is easy to miss: the *request* handler is given `mediaTypes` (an array),
   * the *check* handler `mediaType` (one string). Reading only the array makes
   * every check fail, which does not block recording — it strips the names off
   * `enumerateDevices`, so a microphone picker shows "Microphone 1" and
   * nothing else.
   */
  const allowed = (
    permission: string,
    details?: { mediaTypes?: string[]; mediaType?: string }
  ): boolean => {
    if (permission !== 'media') return false

    const types = details?.mediaTypes ?? (details?.mediaType ? [details.mediaType] : [])
    // `media` covers the camera too, so an empty or unknown type is refused
    // rather than assumed to be audio.
    return types.length > 0 && types.every((type) => type === 'audio')
  }

  const session = win.webContents.session
  session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed(permission, details as { mediaTypes?: string[] }))
  })
  session.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    allowed(permission, details as unknown as { mediaTypes?: string[]; mediaType?: string })
  )
}

/** Matches `--lum-bg` in the light theme, so the window never flashes white. */
const LIGHT_BG = '#faf9f5'
const DARK_BG = '#262624'

export interface Bounds {
  width: number
  height: number
  x?: number
  y?: number
}

/**
 * Drop a saved position that no longer lands on a screen.
 *
 * Monitors get unplugged and resolutions change, and a window restored onto a
 * display that is gone opens somewhere the user cannot see or reach. Keeping
 * the size but forgetting the position puts it back on the primary display.
 */
function onScreen(bounds: Bounds | undefined): Bounds | undefined {
  if (!bounds) return undefined
  if (bounds.x === undefined || bounds.y === undefined) return bounds

  const { x, y, width, height } = bounds
  // Enough of the title bar has to be reachable to move the window by hand.
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(x + width, a.x + a.width) - Math.max(x, a.x)
    const overlapY = Math.min(y + height, a.y + a.height) - Math.max(y, a.y)
    return overlapX >= 120 && overlapY >= 40
  })

  return visible ? bounds : { width, height }
}

/**
 * `show: false` builds the window without ever showing it — how the tray keeps
 * a warm window around when "preload the window in the background" is on. The
 * caller shows it later (`showWindow` in `index.ts`).
 */
export function createWindow(
  saved: Bounds | undefined,
  dark: boolean,
  { show = true }: { show?: boolean } = {}
): BrowserWindow {
  const bounds = onScreen(saved)

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

  grantMicrophoneOnly(win)

  if (show) win.once('ready-to-show', () => win.show())

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
