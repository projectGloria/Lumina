import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { CH } from '@shared/channels'
import { isMarkdownPath } from '@shared/markdown-parse'
import type { FileOpenRequest, Settings, ThemeFile, VaultChange, WorkspaceState } from '@shared/types'
import {
  buildIndex,
  cancelCacheSave,
  forgetNote,
  forgetNotesUnder,
  getIndex,
  indexNote,
  scheduleCacheSave
} from './indexer'
import { resolveFile, toRequest } from './openFile'
import { samePath } from './paths'
import { search, searchTitles } from './search'
import {
  ensureLuminaDir,
  loadAppState,
  loadSettings,
  loadTheme,
  loadWorkspace,
  rememberVault,
  saveSettings,
  saveTheme,
  saveWorkspace
} from './settings'
import { openSnippetsFolder, readSnippets, startSnippetWatcher, stopSnippetWatcher } from './snippets'
import { isEmptyVault, seedVault } from './starter'
import { startWatcher, stopWatcher } from './watcher'
import {
  createFolder,
  createNote,
  deletePath,
  getRoot,
  noteExists,
  readNote,
  readTree,
  renamePath,
  revealInExplorer,
  saveAttachment,
  setRoot,
  writeNote
} from './vault'

let win: BrowserWindow | null = null

export function setMainWindow(w: BrowserWindow): void {
  win = w
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/**
 * Notes the OS asked for before the renderer was listening.
 *
 * A cold start driven by a double-click opens the vault while the page is
 * still loading, so the request would land before React subscribed. The
 * renderer drains this on mount, the same way it asks for the current vault.
 */
let rendererListening = false
const pendingRequests: FileOpenRequest[] = []

function pushFileRequest(request: FileOpenRequest): void {
  // No live window means no listener, however ready the last one was — macOS
  // keeps the app running with every window closed.
  if (rendererListening && win && !win.isDestroyed()) send(CH.fileOpened, request)
  else pendingRequests.push(request)
}

/**
 * Give the renderer a chance to write out anything still dirty, and wait for it.
 *
 * Autosave is debounced, so at any moment up to a few hundred milliseconds of
 * typing exists only in the renderer. Quitting without waiting would throw that
 * away — the one bug a note app cannot afford. The timeout means a wedged
 * renderer delays the quit rather than preventing it.
 */
export function flushRenderer(timeoutMs = 3000): Promise<void> {
  if (!win || win.isDestroyed()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener(CH.appFlushed, done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    ipcMain.once(CH.appFlushed, done)
    send(CH.appFlush)
  })
}

/** Bring the window forward, for a note opened from outside the app. */
function focusWindow(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/* ------------------------------------------------------------ open a vault */

/** Everything the renderer needs to draw a freshly opened vault in one payload. */
async function vaultPayload(vault: string) {
  const [settings, theme, workspace, tree, snippets] = await Promise.all([
    loadSettings(vault),
    loadTheme(vault),
    loadWorkspace(vault),
    readTree(),
    readSnippets(vault)
  ])
  return {
    vault: { path: vault, name: path.basename(vault), lastOpened: Date.now() },
    settings,
    theme,
    workspace,
    tree,
    snippets,
    index: await getIndex()
  }
}

export async function openVault(dir: string) {
  // Anything still dirty belongs to the vault being left, and writes resolve
  // against the root, so it has to reach disk before the root moves.
  if (getRoot()) await flushRenderer()

  await setRoot(dir)
  await ensureLuminaDir(dir)

  if (await isEmptyVault(dir)) await seedVault(dir)

  await rememberVault(dir)
  const stats = await buildIndex()
  scheduleCacheSave(1000)

  startWatcher(dir, (changes) => void applyChanges(changes))
  startSnippetWatcher(dir, (snippets) => send(CH.snippetsChanged, snippets))

  const payload = await vaultPayload(dir)
  send(CH.vaultOpened, payload)
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[lumina] indexed ${stats.total} notes in ${stats.ms}ms ` +
        `(${stats.parsed} parsed, ${stats.reused} from cache)`
    )
  }
  return payload
}

/* ----------------------------------------------- a note handed to us by the OS */

/**
 * Open a note the OS gave us, opening or switching vaults if that is what it
 * takes. `adopt` skips the "is this folder a vault?" question, because the
 * renderer only calls back with it once the user has answered.
 *
 * Returns true when a note was actually opened, so startup can tell whether it
 * still needs to fall back to the last vault.
 */
export async function openFileFromDisk(fileAbs: string, adopt = false): Promise<boolean> {
  const recents = (await loadAppState()).recentVaults.map((v) => v.path)
  const resolved = await resolveFile(fileAbs, getRoot(), recents)
  if (!resolved) return false

  if (resolved.unknown && !adopt) {
    pushFileRequest(toRequest(resolved))
    focusWindow()
    return false
  }

  const root = getRoot()
  if (!root || !samePath(root, resolved.vault)) await openVault(resolved.vault)

  pushFileRequest({ path: resolved.path, ask: null })
  focusWindow()
  return true
}

/**
 * Fold a batch of filesystem events into the index, then tell the renderer
 * once. Tree changes and index changes travel together so the UI never shows a
 * file that the index does not know about.
 */
async function applyChanges(changes: VaultChange[]): Promise<void> {
  let structural = false

  for (const change of changes) {
    if (change.type === 'add' || change.type === 'change') {
      await indexNote(change.path)
      if (change.type === 'add') structural = true
    } else if (change.type === 'unlink') {
      forgetNote(change.path)
      structural = true
    } else if (change.type === 'unlinkDir') {
      // Some platforms report a deleted tree as one `unlinkDir` and no
      // `unlink` for the notes inside it, so drop them here rather than
      // leaving the index describing files that are gone.
      forgetNotesUnder(change.path)
      structural = true
    } else {
      structural = true
    }
  }

  const tree = structural ? await readTree() : null
  send(CH.vaultChanged, { changes, tree, index: await getIndex() })
  scheduleCacheSave()
}

/** Re-read the tree and push it, after an operation we performed ourselves. */
async function pushTree(): Promise<void> {
  send(CH.vaultChanged, { changes: [], tree: await readTree(), index: await getIndex() })
  scheduleCacheSave()
}

/* -------------------------------------------------------------- handlers */

export function registerIpc(): void {
  /* window chrome ------------------------------------------------------- */
  ipcMain.on(CH.winMinimize, () => win?.minimize())
  ipcMain.on(CH.winMaximize, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(CH.winClose, () => win?.close())
  ipcMain.handle(CH.winIsMaximized, () => win?.isMaximized() ?? false)

  /* vault --------------------------------------------------------------- */
  ipcMain.handle(CH.vaultPick, async () => {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for your vault',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open as vault'
    })
    if (res.canceled || !res.filePaths[0]) return null
    return openVault(res.filePaths[0])
  })

  ipcMain.handle(CH.vaultOpen, async (_e, dir: string) => {
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) return null
    } catch {
      return null
    }
    return openVault(dir)
  })

  ipcMain.handle(CH.vaultCurrent, async () => {
    const root = getRoot()
    return root ? vaultPayload(root) : null
  })

  ipcMain.handle(CH.vaultRecent, async () => (await loadAppState()).recentVaults)
  ipcMain.handle(CH.vaultTree, () => readTree())
  ipcMain.handle(CH.vaultReveal, (_e, rel: string) => revealInExplorer(rel))

  // The renderer sends back the absolute path it was asked about, once the
  // user has agreed to treat the containing folder as a vault.
  ipcMain.handle(CH.fileOpen, (_e, fileAbs: string) => openFileFromDisk(fileAbs, true))

  // Called once as the renderer mounts: anything that arrived while the page
  // was still loading is handed over here instead of being lost.
  ipcMain.handle(CH.filePending, () => {
    rendererListening = true
    return pendingRequests.splice(0, pendingRequests.length)
  })

  /* notes --------------------------------------------------------------- */
  ipcMain.handle(CH.noteRead, (_e, rel: string) => readNote(rel))

  ipcMain.handle(CH.noteWrite, async (_e, rel: string, content: string) => {
    const res = await writeNote(rel, content)
    if (res.ok) {
      await indexNote(rel)
      send(CH.indexUpdated, await getIndex())
      scheduleCacheSave()
    }
    return res
  })

  ipcMain.handle(CH.noteCreate, async (_e, rel: string, content = '') => {
    const res = await createNote(rel, content)
    if (res.ok && res.data) {
      await indexNote(res.data)
      await pushTree()
    }
    return res
  })

  ipcMain.handle(CH.noteCreateFolder, async (_e, rel: string) => {
    const res = await createFolder(rel)
    if (res.ok) await pushTree()
    return res
  })

  ipcMain.handle(CH.noteRename, async (_e, from: string, to: string) => {
    const res = await renamePath(from, to)
    if (res.ok && res.data) {
      forgetNote(from)
      await indexNote(res.data)
      // A folder rename moves many notes at once; a rebuild is simplest.
      if (!isMarkdownPath(from)) await buildIndex()
      await pushTree()
    }
    return res
  })

  ipcMain.handle(CH.noteDelete, async (_e, rel: string) => {
    const res = await deletePath(rel)
    if (res.ok) {
      forgetNote(rel)
      if (!isMarkdownPath(rel)) await buildIndex()
      await pushTree()
    }
    return res
  })

  ipcMain.handle(CH.noteExists, (_e, rel: string) => noteExists(rel))

  /* index + search ------------------------------------------------------ */
  ipcMain.handle(CH.indexGet, async () => await getIndex())
  ipcMain.handle(CH.searchQuery, (_e, q: string, mode: 'full' | 'titles' = 'full') =>
    mode === 'titles' ? searchTitles(q) : search(q)
  )

  /* settings, theme, snippets ------------------------------------------- */
  ipcMain.handle(CH.settingsGet, async () => {
    const root = getRoot()
    return root ? loadSettings(root) : null
  })

  ipcMain.handle(CH.settingsSet, async (_e, settings: Settings) => {
    const root = getRoot()
    if (root) await saveSettings(root, settings)
    return true
  })

  ipcMain.handle(CH.themeGet, async () => {
    const root = getRoot()
    return root ? loadTheme(root) : null
  })

  ipcMain.handle(CH.themeSet, async (_e, theme: ThemeFile) => {
    const root = getRoot()
    if (root) await saveTheme(root, theme)
    return true
  })

  ipcMain.handle(CH.snippetsGet, async () => {
    const root = getRoot()
    return root ? readSnippets(root) : []
  })

  ipcMain.handle(CH.snippetsOpenFolder, async () => {
    const root = getRoot()
    if (root) await openSnippetsFolder(root)
  })

  /* workspace ----------------------------------------------------------- */
  ipcMain.handle(CH.workspaceGet, async () => {
    const root = getRoot()
    return root ? loadWorkspace(root) : null
  })

  ipcMain.handle(CH.workspaceSet, async (_e, ws: WorkspaceState) => {
    const root = getRoot()
    if (root) await saveWorkspace(root, ws)
    return true
  })

  /* attachments and export ---------------------------------------------- */
  ipcMain.handle(
    CH.attachmentSave,
    (_e, folder: string, name: string, data: ArrayBuffer) => saveAttachment(folder, name, data)
  )

  ipcMain.handle(CH.exportHtml, async (_e, title: string, html: string) => {
    if (!win) return { ok: false, error: 'No window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export as HTML',
      defaultPath: `${title}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }
    await fs.writeFile(res.filePath, html, 'utf8')
    return { ok: true }
  })

  ipcMain.handle(CH.exportPdf, async (_e, title: string, html: string) => {
    if (!win) return { ok: false, error: 'No window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export as PDF',
      defaultPath: `${title}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }

    // Render in an offscreen window so the export is the note, not the app.
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await printer.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
      })
      await fs.writeFile(res.filePath, pdf)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      printer.destroy()
    }
  })

  ipcMain.handle(CH.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
}

export async function teardown(): Promise<void> {
  cancelCacheSave()
  await Promise.all([stopWatcher(), stopSnippetWatcher()])
}
