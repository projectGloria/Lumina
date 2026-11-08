import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH } from '@shared/channels'
import type { LinkMetadata } from '@shared/linkPreview'
import type { ClipPayload } from '@shared/clip'

import type {
  MusicListing,
  ClipperStatus,
  FileOpenRequest,
  SpeechInstallProgress,
  SpeechPack,
  FolderNode,
  HomeLayout,
  OpResult,
  Profile,
  SearchHit,
  SearchOptions,
  Settings,
  SettingsPreset,
  ThemeFile,
  TranscribeResponse,
  TreeNode,
  VaultChange,
  VaultIndex,
  VaultInfo,
  VoiceToolStatus,
  WorkspaceState,
  WriteResult
} from '@shared/types'

export interface Snippet {
  name: string
  css: string
}

export interface VaultPayload {
  vault: VaultInfo
  settings: Settings
  theme: ThemeFile
  workspace: WorkspaceState
  tree: TreeNode[]
  snippets: Snippet[]
  index: VaultIndex
}

export interface VaultChangedPayload {
  changes: VaultChange[]
  tree: TreeNode[] | null
  index: VaultIndex
}

/** Subscribe helper that hands back an unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

let currentVault: string | null = null
ipcRenderer.on(CH.vaultClosed, () => { currentVault = null })
ipcRenderer.on(CH.vaultOpened, (_event, payload: VaultPayload) => { currentVault = payload.vault.path })
function invokeVault<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, currentVault, ...args)
}

const api = {
  window: {
    minimize: () => ipcRenderer.send(CH.winMinimize),
    toggleMaximize: () => ipcRenderer.send(CH.winMaximize),
    close: () => ipcRenderer.send(CH.winClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(CH.winIsMaximized),
    setOverlay: (bg: string, symbol: string): Promise<void> =>
      ipcRenderer.invoke('win:setOverlay', bg, symbol),
    onMaximizeChanged: (cb: (max: boolean) => void) => on<boolean>(CH.winMaximizeChanged, cb)
  },

  app: {
    /** The main process is shutting down and is waiting for pending saves. */
    onFlush: (cb: (id: string) => void) => on<string>(CH.appFlush, cb),
    onResume: (cb: () => void) => on<void>(CH.appResume, cb),
    flushed: (id: string, error?: string): void => ipcRenderer.send(CH.appFlushed, id, error)
  },

  vault: {
    close: (): Promise<void> => ipcRenderer.invoke(CH.vaultClose),
    onClosed: (cb: () => void) => on<void>(CH.vaultClosed, cb),
    pick: (): Promise<VaultPayload | null> => ipcRenderer.invoke(CH.vaultPick),
    open: (dir: string): Promise<VaultPayload | null> => ipcRenderer.invoke(CH.vaultOpen, dir),
    current: async (): Promise<VaultPayload | null> => {
      const payload = await ipcRenderer.invoke(CH.vaultCurrent)
      if (payload) currentVault = payload.vault.path
      return payload
    },
    recent: (): Promise<VaultInfo[]> => ipcRenderer.invoke(CH.vaultRecent),
    tree: (): Promise<TreeNode[]> => invokeVault(CH.vaultTree),
    reveal: (rel: string): Promise<void> => invokeVault(CH.vaultReveal, rel),
    onOpened: (cb: (p: VaultPayload) => void) => on<VaultPayload>(CH.vaultOpened, cb),
    onChanged: (cb: (p: VaultChangedPayload) => void) =>
      on<VaultChangedPayload>(CH.vaultChanged, cb)
  },

  notes: {
    read: (rel: string): Promise<OpResult<{ content: string; mtime: number }>> =>
      invokeVault(CH.noteRead, rel),
    /**
     * `forVault` is the vault path the caller composed this text against. Main
     * refuses the write when the open vault is no longer that one, which is
     * what stops an autosave fired during a vault switch from landing in the
     * vault being opened.
     */
    write: (rel: string, content: string, forVault?: string, expected?: string): Promise<WriteResult> =>
      invokeVault(CH.noteWrite, rel, content, forVault, expected),
    create: (rel: string, content?: string, forVault?: string): Promise<OpResult<string>> =>
      invokeVault(CH.noteCreate, rel, content ?? '', forVault),
    createFolder: (rel: string): Promise<OpResult<string>> =>
      invokeVault(CH.noteCreateFolder, rel),
    rename: (from: string, to: string): Promise<OpResult<string>> =>
      invokeVault(CH.noteRename, from, to),
    remove: (rel: string): Promise<OpResult> => invokeVault(CH.noteDelete, rel),
    exists: (rel: string): Promise<boolean> => invokeVault(CH.noteExists, rel)
  },

  index: {
    get: (): Promise<VaultIndex> => invokeVault(CH.indexGet),
    onUpdated: (cb: (i: VaultIndex) => void) => on<VaultIndex>(CH.indexUpdated, cb)
  },

  search: {
    query: (q: string, opts?: SearchOptions): Promise<SearchHit[]> =>
      invokeVault(CH.searchQuery, q, 'full', opts),
    titles: (q: string): Promise<{ path: string; title: string }[]> =>
      invokeVault(CH.searchQuery, q, 'titles')
  },

  profiles: {
    list: (): Promise<{ profiles: Profile[]; activeProfileId: string | null }> =>
      ipcRenderer.invoke(CH.profileList),
    create: (name: string): Promise<Profile> => ipcRenderer.invoke(CH.profileCreate, name),
    rename: (id: string, name: string): Promise<void> => ipcRenderer.invoke(CH.profileRename, id, name),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(CH.profileDelete, id),
    setVault: (id: string, vaultPath: string): Promise<void> =>
      ipcRenderer.invoke(CH.profileSetVault, id, vaultPath),
    setPassword: (id: string, password: string | null): Promise<void> =>
      ipcRenderer.invoke(CH.profileSetPassword, id, password),
    unlock: (id: string, password: string): Promise<boolean> =>
      ipcRenderer.invoke(CH.profileUnlock, id, password),
    switch: (id: string): Promise<boolean> => ipcRenderer.invoke(CH.profileSwitch, id),
    signOut: (): Promise<void> => ipcRenderer.invoke(CH.profileSignOut)
  },

  settings: {
    get: (): Promise<Settings | null> => invokeVault(CH.settingsGet),
    set: (s: Settings, forVault = currentVault): Promise<boolean> => ipcRenderer.invoke(CH.settingsSet, forVault, s),
    fonts: (): Promise<string[]> => ipcRenderer.invoke(CH.fontsList),
    profiles: (): Promise<SettingsPreset[]> => ipcRenderer.invoke(CH.settingsProfilesList),
    saveProfile: (name: string, settings: Settings, theme: ThemeFile): Promise<SettingsPreset> =>
      ipcRenderer.invoke(CH.settingsProfilesSave, name, settings, theme),
    deleteProfile: (id: string): Promise<void> => ipcRenderer.invoke(CH.settingsProfilesDelete, id),
    importProfile: (): Promise<SettingsPreset | null> => ipcRenderer.invoke(CH.settingsProfilesImport),
    exportProfile: (profile: SettingsPreset): Promise<boolean> =>
      ipcRenderer.invoke(CH.settingsProfilesExport, profile)
  },

  theme: {
    get: (): Promise<ThemeFile | null> => invokeVault(CH.themeGet),
    set: (t: ThemeFile, forVault = currentVault): Promise<boolean> => ipcRenderer.invoke(CH.themeSet, forVault, t)
  },

  snippets: {
    get: (): Promise<Snippet[]> => invokeVault(CH.snippetsGet),
    openFolder: (): Promise<void> => invokeVault(CH.snippetsOpenFolder),
    onChanged: (cb: (s: Snippet[]) => void) => on<Snippet[]>(CH.snippetsChanged, cb)
  },

  workspace: {
    get: (): Promise<WorkspaceState | null> => invokeVault(CH.workspaceGet),
    set: (w: WorkspaceState, forVault = currentVault): Promise<boolean> => ipcRenderer.invoke(CH.workspaceSet, forVault, w)
  },

  /**
   * The Home board's widget layout, per vault. `get` resolves null when this
   * vault has never had one, which is what tells the renderer to seed the
   * starter board instead of drawing an empty page.
   */
  home: {
    get: (): Promise<HomeLayout | null> => invokeVault(CH.homeGet),
    set: (layout: HomeLayout, forVault = currentVault): Promise<boolean> => ipcRenderer.invoke(CH.homeSet, forVault, layout)
  },

  music: {
    /** Choose the music folder. The path is stored through `settings:set`. */
    pick: (): Promise<string | null> => ipcRenderer.invoke(CH.musicPick),
    /** Walk it. Called when the player is first opened, never at startup. */
    list: (): Promise<MusicListing> => ipcRenderer.invoke(CH.musicList),
    /**
     * Cover art out of one track's own tags, as a `lumina://art/...` URL, or
     * null when the file carries none. Asked for a track being drawn or
     * played — never for the whole library.
     */
    art: (path: string): Promise<string | null> => ipcRenderer.invoke(CH.musicArt, path)
  },

  links: {
    /**
     * Page metadata for a link banner, or null when previews are off, the URL
     * is not http(s), or the page said nothing about itself.
     */
     preview: (url: string): Promise<LinkMetadata | null> =>
      invokeVault(CH.linkPreview, url)
  },

  quickNote: {
    /** The OS-wide shortcut was pressed. */
    onRequest: (cb: () => void) => on<void>(CH.quickNote, cb),
    /** Presses that arrived while the page was still loading. Call once, on mount. */
    takePending: (): Promise<number> => ipcRenderer.invoke(CH.quickNotePending),
    /** Whether the accelerator could be bound after a settings change. */
    onStatus: (cb: (s: { accelerator: string; registered: boolean }) => void) =>
      on<{ accelerator: string; registered: boolean }>(CH.quickNoteStatus, cb),
    /** Create a "Lumina Quick Note" shortcut (targets the launcher exe) on the desktop. */
    createDesktopShortcut: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(CH.quickNoteCreateShortcut)
  },

  files: {
    /** A note the OS asked us to open, e.g. by double-clicking it. */
    onOpenRequest: (cb: (r: FileOpenRequest) => void) => on<FileOpenRequest>(CH.fileOpened, cb),
    /** Requests that arrived while the page was still loading. Call once, on mount. */
    takeOpenRequests: (): Promise<FileOpenRequest[]> => ipcRenderer.invoke(CH.filePending),
    /** Agree to treat the folder around `fileAbs` as a vault, then open it. */
    adoptVault: (fileAbs: string): Promise<boolean> => ipcRenderer.invoke(CH.fileOpen, fileAbs),
    saveAttachment: (folder: string, name: string, data: ArrayBuffer, forVault = currentVault): Promise<OpResult<string>> =>
      ipcRenderer.invoke(CH.attachmentSave, forVault, folder, name, data),
    exportHtml: (title: string, html: string, notePath?: string): Promise<OpResult> =>
      invokeVault(CH.exportHtml, title, html, notePath),
    exportPdf: (title: string, html: string, notePath?: string): Promise<OpResult> =>
      invokeVault(CH.exportPdf, title, html, notePath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CH.openExternal, url)
  },

  /**
   * Dictation. The renderer captures the audio — only it has a microphone —
   * and hands over 16 kHz mono WAV bytes; the main process owns the model and
   * the child process, so no path to a binary ever reaches the page.
   */
  voice: {
    status: (): Promise<VoiceToolStatus> => invokeVault(CH.voiceStatus),
    transcribe: (wav: ArrayBuffer, language?: string): Promise<TranscribeResponse> =>
      invokeVault(CH.voiceTranscribe, wav, language),
    /** Bring up the resident model. Resolves with a reason when it could not. */
    liveStart: (): Promise<string | null> => invokeVault(CH.voiceLiveStart),
    /** One phrase against the resident model; null when it could not be read. */
    transcribeLive: (wav: ArrayBuffer, language?: string): Promise<string | null> =>
      invokeVault(CH.voiceLiveChunk, wav, language),
    liveStop: (): Promise<void> => ipcRenderer.invoke(CH.voiceLiveStop),

    /**
     * Speech engines and models carried inside the installer.
     *
     * Nothing here touches the network: installing copies out of the build,
     * importing copies from a folder the user picked.
     */
    packs: (): Promise<SpeechPack[]> => ipcRenderer.invoke(CH.speechPacks),
    installPack: (id: string): Promise<string | null> =>
      ipcRenderer.invoke(CH.speechInstall, id),
    importPack: (): Promise<string | null> => ipcRenderer.invoke(CH.speechImport),
    removePack: (id: string): Promise<string | null> =>
      ipcRenderer.invoke(CH.speechRemove, id),
    onPackProgress: (cb: (progress: SpeechInstallProgress) => void) =>
      on<SpeechInstallProgress>(CH.speechProgress, cb)
  },

  /**
   * The web clipper. Main owns the socket and the network; the renderer only
   * ever sees a validated clip and turns it into a note.
   */
  clipper: {
    onClip: (cb: (clip: ClipPayload) => void) => on<ClipPayload>(CH.clipArrived, cb),
    /** Clips that arrived before the renderer was listening. Call once, on mount. */
    takePending: (): Promise<ClipPayload[]> => ipcRenderer.invoke(CH.clipPending),
    status: (): Promise<ClipperStatus> => ipcRenderer.invoke(CH.clipStatus),
    regenerateToken: (): Promise<string> => ipcRenderer.invoke(CH.clipRegenerateToken),
    /** Copy one remote image into the vault; null when it could not be had. */
    saveImage: (folder: string, url: string, forVault = currentVault): Promise<string | null> =>
      ipcRenderer.invoke(CH.clipSaveImage, forVault, folder, url)
  }
}

export type LuminaApi = typeof api
export type { FolderNode }

contextBridge.exposeInMainWorld('lumina', api)
