import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { CH } from '@shared/channels'
import { isMarkdownPath } from '@shared/markdown-parse'
import type { ClipPayload } from '@shared/clip'
import type {
  ClipperSettings,
  ClipperStatus,
  FileOpenRequest,
  SearchOptions,
  Settings,
  SettingsPreset,
  ThemeFile,
  TranscribeResponse,
  VaultChange,
  VoiceToolStatus,
  HomeLayout,
  WorkspaceState
} from '@shared/types'
import {
  buildIndex,
  cancelCacheSave,
  forgetNote,
  forgetNotesUnder,
  getIndex,
  indexNote,
  scheduleCacheSave
} from './indexer'
import { forgetLinkPreviews, linkPreview } from './linkPreview'
import { listSystemFonts } from './fonts'
import { describeMissing, locateVoiceTools, transcribe, type VoiceTools } from './transcribe'
import { ensureWhisperServer, stopWhisperServer, transcribeLive } from './whisperServer'
import {
  importSpeechPack,
  installSpeechPack,
  listSpeechPacks,
  removeSpeechPack,
  type SpeechPack
} from './speechPacks'
import { createQuickNoteDesktopShortcut } from './quicknote/shortcut'
import {
  clipServerRunning,
  DEFAULT_CLIP_PORT,
  generateClipToken,
  startClipServer,
  stopClipServer
} from './clipServer'
import { saveClipImage } from './clipImages'
import { resolveFile, toRequest } from './openFile'
import { samePath } from './paths'
import {
  createProfile,
  deleteProfile,
  getActiveProfileId,
  listProfiles,
  renameProfile,
  setProfilePassword,
  setProfileVault,
  signOutProfile,
  switchProfile,
  unlockProfile
} from './profiles'
import { listMusic, setMusicRoot } from './music'
import { resetArtCache, trackArt } from './musicArt'
import { search, searchTitles } from './search'
import {
  ensureLuminaDir,
  loadAppState,
  loadSettings,
  loadHome,
  loadTheme,
  loadWorkspace,
  normalizeSettings,
  normalizeTheme,
  rememberVault,
  saveSettings,
  saveAppState,
  saveHome,
  saveTheme,
  saveWorkspace,
  stripMachineSettings
} from './settings'
import { cleanupTempHtml, embedLocalImages, writeTempHtml } from './export'
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
  rootMatches,
  saveAttachment,
  setRoot,
  writeNote
} from './vault'

let win: BrowserWindow | null = null

/**
 * Called after settings are written, so `index.ts` can re-apply the parts of
 * them that live outside the renderer. Set once at startup.
 */
let onSettingsSaved: ((settings: Settings) => void) | null = null

/**
 * Why the clip listener is not up, kept so settings can show it.
 *
 * The usual cause is a port already taken, which is a thing the user has to be
 * told about — a clipper that silently is not listening looks like a broken
 * extension.
 */
let clipStartError: string | null = null

/**
 * The configuration the listener is currently running with.
 *
 * Without this, every settings write restarted the socket — and settings are
 * written for things that have nothing to do with the clipper, like starring a
 * note. That dropped any clip arriving during the teardown, and a rapid
 * sequence of unrelated preference changes could race `close()` against
 * `listen()` and report a spurious "port already in use".
 */
let appliedClipper: { enabled: boolean; port: number; token: string } | null = null

/**
 * Bring the clip listener in line with the settings.
 *
 * Takes `ClipperSettings` rather than the whole `Settings` because these are
 * app-level: the listener comes up at boot from `lumina.json`, before any vault
 * is open and even when the app started into the tray with no window. That is
 * the point — the extension can reach Lumina whenever Lumina is running, and a
 * clip arriving with no vault yet is held by `drainClips` in the renderer
 * rather than refused at the socket.
 *
 * Called after every settings save, so toggling it takes effect without a
 * restart and turning it off actually closes the socket — but a save that did
 * not touch the clipper leaves the socket alone.
 */
export async function syncClipServer(clipper: ClipperSettings): Promise<void> {
  const { enabled, port, token } = clipper

  const unchanged =
    appliedClipper !== null &&
    appliedClipper.enabled === enabled &&
    appliedClipper.port === port &&
    appliedClipper.token === token
  // Only skip when the listener is actually in the state that configuration
  // describes; a server that died on its own still needs bringing back.
  if (unchanged && clipServerRunning() === (enabled && !!token)) return

  appliedClipper = { enabled, port, token }

  if (!enabled || !token) {
    clipStartError = null
    await stopClipServer()
    return
  }
  clipStartError = await startClipServer({
    port,
    token,
    onClip: async (clip) => {
      pushClip(clip)
      // The extension is told the clip was accepted, not that the note was
      // written: the renderer may still be starting, and making the browser
      // wait on that would time out the popup for no benefit.
      return { ok: true }
    }
  })
}

export function onSettingsChanged(handler: (settings: Settings) => void): void {
  onSettingsSaved = handler
}

export function setMainWindow(w: BrowserWindow): void {
  win = w
  // A replacement window starts with a renderer that has not drained anything
  // yet; leaving this true would send a quick-note request into a page that is
  // still loading, where nothing is listening for it.
  rendererListening = false
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

/**
 * Quick-note presses waiting for the renderer, counted rather than queued.
 *
 * The shortcut is the one path that routinely fires before there is anything
 * listening: pressing it with Lumina idling in the tray creates the window,
 * and the press has to survive the whole cold start. This remains a count so
 * no request is lost; the renderer may intentionally reuse the same generated
 * note while it remains blank.
 */
let pendingQuickNotes = 0

export function pushQuickNote(): void {
  if (rendererListening && win && !win.isDestroyed()) send(CH.quickNote)
  else pendingQuickNotes++
}

/** Tell the renderer a shortcut change did or did not take, so it can say so. */
export function reportQuickNoteStatus(accelerator: string, registered: boolean): void {
  send(CH.quickNoteStatus, { accelerator, registered })
}

/**
 * Clips waiting for the renderer.
 *
 * Same shape as the quick note and for the same reason: a clip can land while
 * Lumina is idling in the tray with no window at all. These are queued rather
 * than counted, because unlike a keypress each one carries a page — dropping
 * the second of two clips would silently lose a note the user watched the
 * browser say it had sent.
 */
const pendingClips: ClipPayload[] = []

/** Raised by `index.ts` so a clip can build the window before it is delivered. */
let onClipArrived: (() => void) | null = null

export function setClipArrivedHandler(handler: () => void): void {
  onClipArrived = handler
}

export function pushClip(clip: ClipPayload): void {
  if (rendererListening && win && !win.isDestroyed()) send(CH.clipArrived, clip)
  else pendingClips.push(clip)
  onClipArrived?.()
}

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
let pendingFlush: Promise<void> | null = null
export function resumeRenderer(): void { send(CH.appResume) }
export function flushRenderer(timeoutMs = 15000): Promise<void> {
  if (!win || win.isDestroyed()) return Promise.resolve()
  if (pendingFlush) return pendingFlush
  const id = randomUUID()
  pendingFlush = new Promise<void>((resolve, reject) => {
    const finish = (error?: string): void => {
      clearTimeout(timer)
      ipcMain.removeListener(CH.appFlushed, done)
      if (error) { resumeRenderer(); reject(new Error(error)) } else resolve()
    }
    const done = (event: Electron.IpcMainEvent, token: string, error?: string): void => {
      if (token === id && event.sender === win?.webContents) finish(error)
    }
    const timer = setTimeout(() => finish('Saving timed out. The operation was cancelled to keep your edits.'), timeoutMs)
    ipcMain.on(CH.appFlushed, done)
    send(CH.appFlush, id)
  }).finally(() => { pendingFlush = null })
  return pendingFlush
}

/** Bring the window forward, for a note opened from outside the app. */
function focusWindow(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Whether the user has turned link previews on, mirrored here so the fetch is
 * refused in the main process rather than only skipped in the renderer. Any
 * URL in any note is a candidate, so the offline promise is worth enforcing
 * where the network call actually happens.
 */
let linkPreviewsEnabled = false
/** The music folder last seen in a save, so a change to it can be noticed. */
let musicFolder = ''

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
  linkPreviewsEnabled = settings.editor.linkPreviews
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

let switchChain: Promise<unknown> = Promise.resolve()
let transitioning = false
const activeOperations = new Set<Promise<unknown>>()

export function openVault(dir: string): ReturnType<typeof switchVault> {
  const operation = switchChain.catch(() => {}).then(() => switchVault(dir))
  switchChain = operation
  return operation
}

function closeVault(): Promise<void> {
  const operation = switchChain.catch(() => {}).then(async () => {
    if (getRoot()) await flushRenderer()
    transitioning = true
    try {
      await Promise.all([stopWatcher(), stopSnippetWatcher()])
      await Promise.allSettled([...activeOperations])
      await changeChain
      cancelCacheSave()
      await setRoot(null)
      forgetLinkPreviews()
      send(CH.vaultClosed)
    } finally { transitioning = false; resumeRenderer() }
  })
  switchChain = operation
  return operation
}

async function switchVault(dir: string) {
  // Anything still dirty belongs to the vault being left, and writes resolve
  // against the root, so it has to reach disk before the root moves.
  if (getRoot()) await flushRenderer()

  transitioning = true
  const previous = getRoot()
  try {
  await Promise.all([stopWatcher(), stopSnippetWatcher()])
  await Promise.allSettled([...activeOperations])
  await changeChain
  cancelCacheSave()
  await setRoot(dir)
  // The link cache lives in the vault, so the in-memory copy belongs to the
  // one being left.
  forgetLinkPreviews()
  await ensureLuminaDir(dir)

  if (await isEmptyVault(dir)) await seedVault(dir)

  await rememberVault(dir)
  const stats = await buildIndex()
  scheduleCacheSave(1000)

  startWatcher(dir, queueChanges)
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
  } catch (error) {
    if (previous) {
      await setRoot(previous)
      await buildIndex()
      startWatcher(previous, queueChanges)
      startSnippetWatcher(previous, (snippets) => send(CH.snippetsChanged, snippets))
    } else await setRoot(null)
    throw error
  } finally { transitioning = false; resumeRenderer() }
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
/** Files read at once when a batch lands. Enough to hide latency, not enough to thrash. */
const INDEX_CONCURRENCY = 8

/**
 * Batches are applied one after another.
 *
 * `startWatcher` calls this fire-and-forget, so without a chain two batches
 * could interleave their `readTree()` and `getIndex()` calls and push a staler
 * tree after a fresher one. Same shape as the persistence chains in
 * `settings.ts` and the renderer's stores.
 */
let changeChain: Promise<void> = Promise.resolve()

export function queueChanges(changes: VaultChange[]): void {
  const root = getRoot()
  changeChain = changeChain.catch(() => {}).then(async () => {
    if (getRoot() === root) await applyChanges(changes)
  })
}

async function applyChanges(changes: VaultChange[]): Promise<void> {
  let structural = false

  // Reads are the slow part and they are independent of each other, so they go
  // in bounded-concurrency waves rather than strictly one at a time — a `git
  // checkout` touching hundreds of notes used to mean hundreds of sequential
  // round trips before the renderer heard anything.
  const toIndex: string[] = []
  for (const change of changes) {
    if (change.type === 'add' || change.type === 'change') {
      toIndex.push(change.path)
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

  for (let i = 0; i < toIndex.length; i += INDEX_CONCURRENCY) {
    await Promise.all(toIndex.slice(i, i + INDEX_CONCURRENCY).map((rel) => indexNote(rel)))
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

function handleVault(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, stamp: string | null, ...args: unknown[]) => {
    if (transitioning || stamp !== getRoot()) throw new Error('The vault changed. Retry in the current vault.')
    const operation = Promise.resolve().then(() => handler(event, ...args))
    activeOperations.add(operation)
    void operation.finally(() => activeOperations.delete(operation)).catch(() => {})
    return operation
  })
}

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
  ipcMain.handle(CH.vaultClose, () => closeVault())
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
    await switchChain.catch(() => {})
    await changeChain.catch(() => {})
    const root = getRoot()
    return root ? vaultPayload(root) : null
  })

  ipcMain.handle(CH.vaultRecent, async () => (await loadAppState()).recentVaults)
  handleVault(CH.vaultTree, () => readTree())
  handleVault(CH.vaultReveal, (_e, rel: string) => revealInExplorer(rel))

  // The renderer sends back the absolute path it was asked about, once the
  // user has agreed to treat the containing folder as a vault.
  ipcMain.handle(CH.fileOpen, (_e, fileAbs: string) => openFileFromDisk(fileAbs, true))

  // Called once as the renderer mounts: anything that arrived while the page
  // was still loading is handed over here instead of being lost.
  ipcMain.handle(CH.filePending, () => {
    rendererListening = true
    return pendingRequests.splice(0, pendingRequests.length)
  })

  ipcMain.handle(CH.quickNotePending, () => {
    rendererListening = true
    const count = pendingQuickNotes
    pendingQuickNotes = 0
    return count
  })

  ipcMain.handle(CH.quickNoteCreateShortcut, () => createQuickNoteDesktopShortcut())

  /* notes --------------------------------------------------------------- */
  handleVault(CH.noteRead, (_e, rel: string) => readNote(rel))

  handleVault(CH.noteWrite, async (_e, rel: string, content: string, forVault?: string, expected?: string) => {
    // The renderer stamps every write with the vault it was composed against.
    // A write that arrives after the root has moved belongs to the vault being
    // left, and writing it here would put its text into the new vault's file
    // of the same name — so it is refused rather than redirected.
    if (!rootMatches(forVault)) {
      return { ok: false as const, mtime: 0, error: 'The vault changed before this could be saved' }
    }
    const res = await writeNote(rel, content, expected)
    if (res.ok) {
      changeChain = changeChain.catch(() => {}).then(async () => {
        await indexNote(rel)
        send(CH.indexUpdated, await getIndex())
        scheduleCacheSave()
      })
    }
    return res
  })

  handleVault(CH.noteCreate, async (_e, rel: string, content = '', forVault?: string) => {
    if (!rootMatches(forVault)) {
      return { ok: false as const, error: 'The vault changed before this could be created' }
    }
    const res = await createNote(rel, content)
    if (res.ok && res.data) {
      await indexNote(res.data)
      await pushTree()
    }
    return res
  })

  handleVault(CH.noteCreateFolder, async (_e, rel: string) => {
    const res = await createFolder(rel)
    if (res.ok) await pushTree()
    return res
  })

  handleVault(CH.noteRename, async (_e, from: string, to: string) => {
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

  handleVault(CH.noteDelete, async (_e, rel: string) => {
    const res = await deletePath(rel)
    if (res.ok) {
      forgetNote(rel)
      // A folder takes its notes with it. `forgetNotesUnder` drops them from
      // the index directly; the full `buildIndex` this used to do re-walked and
      // re-stat'd the entire vault to reach the same answer.
      if (!isMarkdownPath(rel)) forgetNotesUnder(rel)
      await pushTree()
    }
    return res
  })

  handleVault(CH.noteExists, (_e, rel: string) => noteExists(rel))

  /* index + search ------------------------------------------------------ */
  handleVault(CH.indexGet, async () => await getIndex())
  handleVault(
    CH.searchQuery,
    (_e, q: string, mode: 'full' | 'titles' = 'full', opts?: SearchOptions) =>
      mode === 'titles' ? searchTitles(q) : search(q, 60, opts)
  )

  /* profiles -------------------------------------------------------------- */
  ipcMain.handle(CH.profileList, async () => ({
    profiles: await listProfiles(),
    activeProfileId: await getActiveProfileId()
  }))
  ipcMain.handle(CH.profileCreate, (_e, name: string) => createProfile(name))
  ipcMain.handle(CH.profileRename, (_e, id: string, name: string) => renameProfile(id, name))
  ipcMain.handle(CH.profileDelete, (_e, id: string) => deleteProfile(id))
  ipcMain.handle(CH.profileSetVault, (_e, id: string, vaultPath: string) => setProfileVault(id, vaultPath))
  ipcMain.handle(CH.profileSetPassword, (_e, id: string, password: string | null) =>
    setProfilePassword(id, password)
  )
  ipcMain.handle(CH.profileUnlock, (_e, id: string, password: string) => unlockProfile(id, password))
  ipcMain.handle(CH.profileSwitch, (_e, id: string) => switchProfile(id))
  ipcMain.handle(CH.profileSignOut, () => signOutProfile())

  /* settings, theme, snippets ------------------------------------------- */
  handleVault(CH.settingsGet, async () => {
    const root = getRoot()
    return root ? loadSettings(root) : null
  })

  handleVault(CH.settingsSet, async (_e, settings: Settings) => {
    const root = getRoot()
    if (root) await saveSettings(root, settings)
    // The quick-note preferences live in this payload but are acted on by the
    // main process (a global accelerator, a tray icon, a login item), so they
    // have to be re-applied on every save rather than only at startup.
    linkPreviewsEnabled = settings.editor.linkPreviews
    // The protocol handler reads the music root straight from here, so it has
    // to follow the setting rather than be read once at startup.
    setMusicRoot(settings.music.folder)
    // A different folder means the remembered art belongs to files that are no
    // longer the ones being asked about.
    if (settings.music.folder !== musicFolder) {
      musicFolder = settings.music.folder
      resetArtCache()
    }
    await syncClipServer(settings.clipper)
    onSettingsSaved?.(settings)
    return true
  })
  ipcMain.handle(CH.fontsList, () => listSystemFonts())

  /* ---------------------------------------------------------- web clipper */

  ipcMain.handle(CH.clipPending, () => {
    const drained = pendingClips.splice(0)
    return drained
  })

  ipcMain.handle(CH.clipStatus, async (): Promise<ClipperStatus> => {
    const root = getRoot()
    const settings = root ? await loadSettings(root) : null
    const port = settings?.clipper.port ?? DEFAULT_CLIP_PORT
    return { running: clipServerRunning(), port, error: clipStartError }
  })

  /**
   * A new token, which also invalidates whatever the extension is holding.
   * Returned rather than pushed so the settings panel can show it immediately.
   */
  ipcMain.handle(CH.clipRegenerateToken, () => generateClipToken())

  handleVault(CH.clipSaveImage, (_e, folder: string, url: string) =>
    saveClipImage(folder, url)
  )

  /* ------------------------------------------------ voice notes and dictation */

  const voiceTools = async (): Promise<VoiceTools> => {
    const root = getRoot()
    const settings = root ? await loadSettings(root) : null
    const voice = settings?.voice
    return locateVoiceTools(app.getPath('userData'), {
      binaryPath: voice?.binaryPath || undefined,
      modelPath: voice?.modelPath || undefined
    })
  }

  handleVault(CH.voiceStatus, async (): Promise<VoiceToolStatus> => {
    const tools = await voiceTools()
    const reason = describeMissing(tools)
    return { available: !reason, reason, folder: tools.folder, binary: tools.binary, model: tools.model }
  })

  handleVault(
    CH.voiceTranscribe,
    async (_e, wav: ArrayBuffer, language?: string): Promise<TranscribeResponse> =>
      transcribe(wav, await voiceTools(), { language })
  )

  /* Live dictation keeps the model resident; see `whisperServer.ts` for why a
     process per phrase cannot keep up. */
  handleVault(CH.voiceLiveStart, async (): Promise<string | null> =>
    ensureWhisperServer(await voiceTools())
  )
  handleVault(CH.voiceLiveChunk, async (_e, wav: ArrayBuffer, language?: string) => {
    const settings = getRoot() ? await loadSettings(getRoot() as string) : null
    return transcribeLive(wav, language ?? settings?.voice.language)
  })
  ipcMain.handle(CH.voiceLiveStop, () => stopWhisperServer())

  /* ------------------------------------------------ bundled speech packs */

  // `resourcesPath` is the packaged app's resources folder. In development it
  // points inside node_modules/electron, where nothing is bundled — so a dev
  // run correctly reports no packs rather than pretending.
  const packRoot = (): string => process.resourcesPath

  ipcMain.handle(CH.speechPacks, (): Promise<SpeechPack[]> =>
    listSpeechPacks(app.getPath('userData'), packRoot())
  )

  ipcMain.handle(CH.speechInstall, (_e, id: string) =>
    installSpeechPack(id, app.getPath('userData'), packRoot(), (progress) =>
      send(CH.speechProgress, progress)
    )
  )

  ipcMain.handle(CH.speechImport, async () => {
    if (!win) return 'No window'
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose a folder holding a speech engine or model',
      properties: ['openDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return importSpeechPack(picked.filePaths[0], app.getPath('userData'), (progress) =>
      send(CH.speechProgress, progress)
    )
  })

  ipcMain.handle(CH.speechRemove, (_e, id: string) =>
    removeSpeechPack(id, app.getPath('userData'))
  )

  ipcMain.handle(CH.settingsProfilesList, async () => (await loadAppState()).settingsProfiles)
  ipcMain.handle(
    CH.settingsProfilesSave,
    async (_e, name: string, settings: Settings, theme: ThemeFile): Promise<SettingsPreset> => {
      const state = await loadAppState()
      const profile: SettingsPreset = {
        id: randomUUID(),
        name: name.trim() || `Settings ${state.settingsProfiles.length + 1}`,
        createdAt: Date.now(),
        settings: normalizeSettings(settings),
        theme: normalizeTheme(theme)
      }
      await saveAppState({ settingsProfiles: [...state.settingsProfiles, profile] })
      return profile
    }
  )
  ipcMain.handle(CH.settingsProfilesDelete, async (_e, id: string) => {
    const state = await loadAppState()
    await saveAppState({ settingsProfiles: state.settingsProfiles.filter((profile) => profile.id !== id) })
  })
  ipcMain.handle(CH.settingsProfilesImport, async (): Promise<SettingsPreset | null> => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Lumina settings',
      properties: ['openFile'],
      filters: [{ name: 'Lumina settings', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const raw = JSON.parse((await fs.readFile(result.filePaths[0], 'utf8')).replace(/^ï»¿/, '')) as Record<string, unknown>
    const source = raw.settings && typeof raw.settings === 'object' ? raw.settings : raw
    const theme = raw.theme && typeof raw.theme === 'object' ? raw.theme : undefined
    const state = await loadAppState()
    const profile: SettingsPreset = {
      id: randomUUID(),
      name: typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : path.basename(result.filePaths[0], path.extname(result.filePaths[0])),
      createdAt: Date.now(),
      // Stripped at the door rather than at apply time: the preset is stored in
      // `lumina.json`, so a dangerous value left in here would survive to be
      // applied later by a user who has forgotten where the file came from.
      settings: stripMachineSettings(normalizeSettings(source)),
      theme: normalizeTheme(theme)
    }
    await saveAppState({ settingsProfiles: [...state.settingsProfiles, profile] })
    return profile
  })
  ipcMain.handle(CH.settingsProfilesExport, async (_e, profile: SettingsPreset): Promise<boolean> => {
    if (!win) return false
    const safeName = profile.name.replace(/[<>:"/\\|?*]/g, '-').trim() || 'Lumina settings'
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Lumina settings',
      defaultPath: `${safeName}.json`,
      filters: [{ name: 'Lumina settings', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, JSON.stringify({
      format: 'lumina-settings',
      version: 1,
      name: profile.name,
      settings: profile.settings,
      theme: profile.theme
    }, null, 2), 'utf8')
    return true
  })

  handleVault(CH.linkPreview, async (_e, url: string) => {
    if (!linkPreviewsEnabled) return null
    return linkPreview(url)
  })

  handleVault(CH.themeGet, async () => {
    const root = getRoot()
    return root ? loadTheme(root) : null
  })

  handleVault(CH.themeSet, async (_e, theme: ThemeFile) => {
    const root = getRoot()
    if (root) await saveTheme(root, theme)
    return true
  })

  handleVault(CH.snippetsGet, async () => {
    const root = getRoot()
    return root ? readSnippets(root) : []
  })

  handleVault(CH.snippetsOpenFolder, async () => {
    const root = getRoot()
    if (root) await openSnippetsFolder(root)
  })

  /* workspace ----------------------------------------------------------- */
  handleVault(CH.workspaceGet, async () => {
    const root = getRoot()
    return root ? loadWorkspace(root) : null
  })

  handleVault(CH.workspaceSet, async (_e, ws: WorkspaceState) => {
    const root = getRoot()
    if (root) await saveWorkspace(root, ws)
    return true
  })

  /* home dashboard ------------------------------------------------------ */
  // Null means this vault has never had a board, which is the renderer's cue
  // to seed a starter layout rather than show an empty page.
  handleVault(CH.homeGet, async () => {
    const root = getRoot()
    return root ? loadHome(root) : null
  })

  handleVault(CH.homeSet, async (_e, layout: HomeLayout) => {
    const root = getRoot()
    if (root) await saveHome(root, layout)
    return true
  })

  /* music ---------------------------------------------------------------- */
  // Two calls and no more: choose the folder, and read it. The folder itself
  // is never indexed, watched, or shown in the tree.
  ipcMain.handle(CH.musicPick, async () => {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose your music folder',
      properties: ['openDirectory'],
      buttonLabel: 'Use this folder'
    })
    const picked = res.canceled ? null : (res.filePaths[0] ?? null)
    // Set here rather than waiting for the settings write to come back: that
    // write is debounced, and the renderer lists the folder as soon as the
    // dialog closes — which would otherwise walk the *previous* root.
    if (picked) setMusicRoot(picked)
    return picked
  })

  // Walked on demand — when the player is first opened — never at startup.
  ipcMain.handle(CH.musicList, () => listMusic())

  // One track's own cover, extracted and cached the first time it is drawn.
  ipcMain.handle(CH.musicArt, async (_e, rel: string) => {
    const name = await trackArt(rel)
    return name ? `lumina://art/${encodeURIComponent(name)}` : null
  })

  /* attachments and export ---------------------------------------------- */
  handleVault(
    CH.attachmentSave,
    (_e, folder: string, name: string, data: ArrayBuffer) => saveAttachment(folder, name, data)
  )


  handleVault(CH.exportHtml, async (_e, title: string, html: string, notePath?: string) => {
    if (!win) return { ok: false, error: 'No window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export as HTML',
      defaultPath: `${title}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }
    const embeddedHtml = await embedLocalImages(html, getRoot(), notePath)
    await fs.writeFile(res.filePath, embeddedHtml, 'utf8')
    return { ok: true }
  })

  handleVault(CH.exportPdf, async (_e, title: string, html: string, notePath?: string) => {
    if (!win) return { ok: false, error: 'No window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export as PDF',
      defaultPath: `${title}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }

    const embeddedHtml = await embedLocalImages(html, getRoot(), notePath)

    // Render in an offscreen window so the export is the note, not the app.
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    // Through a temp file rather than a `data:` URL: inlined images are already
    // base64, and percent-encoding them into a URL inflates that again past the
    // size Chromium will navigate to — which surfaced as a generic failure on
    // exactly the notes most worth exporting.
    let temp: string | null = null
    try {
      temp = await writeTempHtml(embeddedHtml)
      await printer.loadFile(temp)
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
      if (temp) await cleanupTempHtml(temp)
    }
  })

  // `mailto:` is here because the renderer routes it here — `safeExportUrl` in
  // `lib/render.ts` deliberately allows it, and read mode `preventDefault`s the
  // click, so refusing it at this end made those links silently dead rather
  // than safe. `shell.openExternal` hands it to the OS handler, same as http.
  ipcMain.handle(CH.openExternal, (_e, url: string) => {
    if (/^(?:https?:\/\/|mailto:)/i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
}

export async function teardown(): Promise<void> {
  cancelCacheSave()
  await Promise.all([stopWatcher(), stopSnippetWatcher()])
}
