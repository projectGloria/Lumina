import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH } from '@shared/channels'
import type { LinkMetadata } from '@shared/linkPreview'
import type {
  FileOpenRequest,
  FolderNode,
  OpResult,
  Profile,
  SearchHit,
  SearchOptions,
  Settings,
  SettingsPreset,
  ThemeFile,
  TreeNode,
  VaultChange,
  VaultIndex,
  VaultInfo,
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
    onFlush: (cb: () => void) => on<void>(CH.appFlush, cb),
    flushed: (): void => ipcRenderer.send(CH.appFlushed)
  },

  vault: {
    pick: (): Promise<VaultPayload | null> => ipcRenderer.invoke(CH.vaultPick),
    open: (dir: string): Promise<VaultPayload | null> => ipcRenderer.invoke(CH.vaultOpen, dir),
    current: (): Promise<VaultPayload | null> => ipcRenderer.invoke(CH.vaultCurrent),
    recent: (): Promise<VaultInfo[]> => ipcRenderer.invoke(CH.vaultRecent),
    tree: (): Promise<TreeNode[]> => ipcRenderer.invoke(CH.vaultTree),
    reveal: (rel: string): Promise<void> => ipcRenderer.invoke(CH.vaultReveal, rel),
    onOpened: (cb: (p: VaultPayload) => void) => on<VaultPayload>(CH.vaultOpened, cb),
    onChanged: (cb: (p: VaultChangedPayload) => void) =>
      on<VaultChangedPayload>(CH.vaultChanged, cb)
  },

  notes: {
    read: (rel: string): Promise<OpResult<{ content: string; mtime: number }>> =>
      ipcRenderer.invoke(CH.noteRead, rel),
    write: (rel: string, content: string): Promise<WriteResult> =>
      ipcRenderer.invoke(CH.noteWrite, rel, content),
    create: (rel: string, content?: string): Promise<OpResult<string>> =>
      ipcRenderer.invoke(CH.noteCreate, rel, content ?? ''),
    createFolder: (rel: string): Promise<OpResult<string>> =>
      ipcRenderer.invoke(CH.noteCreateFolder, rel),
    rename: (from: string, to: string): Promise<OpResult<string>> =>
      ipcRenderer.invoke(CH.noteRename, from, to),
    remove: (rel: string): Promise<OpResult> => ipcRenderer.invoke(CH.noteDelete, rel),
    exists: (rel: string): Promise<boolean> => ipcRenderer.invoke(CH.noteExists, rel)
  },

  index: {
    get: (): Promise<VaultIndex> => ipcRenderer.invoke(CH.indexGet),
    onUpdated: (cb: (i: VaultIndex) => void) => on<VaultIndex>(CH.indexUpdated, cb)
  },

  search: {
    query: (q: string, opts?: SearchOptions): Promise<SearchHit[]> =>
      ipcRenderer.invoke(CH.searchQuery, q, 'full', opts),
    titles: (q: string): Promise<{ path: string; title: string }[]> =>
      ipcRenderer.invoke(CH.searchQuery, q, 'titles')
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
    get: (): Promise<Settings | null> => ipcRenderer.invoke(CH.settingsGet),
    set: (s: Settings): Promise<boolean> => ipcRenderer.invoke(CH.settingsSet, s),
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
    get: (): Promise<ThemeFile | null> => ipcRenderer.invoke(CH.themeGet),
    set: (t: ThemeFile): Promise<boolean> => ipcRenderer.invoke(CH.themeSet, t)
  },

  snippets: {
    get: (): Promise<Snippet[]> => ipcRenderer.invoke(CH.snippetsGet),
    openFolder: (): Promise<void> => ipcRenderer.invoke(CH.snippetsOpenFolder),
    onChanged: (cb: (s: Snippet[]) => void) => on<Snippet[]>(CH.snippetsChanged, cb)
  },

  workspace: {
    get: (): Promise<WorkspaceState | null> => ipcRenderer.invoke(CH.workspaceGet),
    set: (w: WorkspaceState): Promise<boolean> => ipcRenderer.invoke(CH.workspaceSet, w)
  },

  links: {
    /**
     * Page metadata for a link banner, or null when previews are off, the URL
     * is not http(s), or the page said nothing about itself.
     */
     preview: (url: string): Promise<LinkMetadata | null> =>
      ipcRenderer.invoke(CH.linkPreview, url)
  },

  quickNote: {
    /** The OS-wide shortcut was pressed. */
    onRequest: (cb: () => void) => on<void>(CH.quickNote, cb),
    /** Presses that arrived while the page was still loading. Call once, on mount. */
    takePending: (): Promise<number> => ipcRenderer.invoke(CH.quickNotePending),
    /** Whether the accelerator could be bound after a settings change. */
    onStatus: (cb: (s: { accelerator: string; registered: boolean }) => void) =>
      on<{ accelerator: string; registered: boolean }>(CH.quickNoteStatus, cb)
  },

  files: {
    /** A note the OS asked us to open, e.g. by double-clicking it. */
    onOpenRequest: (cb: (r: FileOpenRequest) => void) => on<FileOpenRequest>(CH.fileOpened, cb),
    /** Requests that arrived while the page was still loading. Call once, on mount. */
    takeOpenRequests: (): Promise<FileOpenRequest[]> => ipcRenderer.invoke(CH.filePending),
    /** Agree to treat the folder around `fileAbs` as a vault, then open it. */
    adoptVault: (fileAbs: string): Promise<boolean> => ipcRenderer.invoke(CH.fileOpen, fileAbs),
    saveAttachment: (folder: string, name: string, data: ArrayBuffer): Promise<OpResult<string>> =>
      ipcRenderer.invoke(CH.attachmentSave, folder, name, data),
    exportHtml: (title: string, html: string): Promise<OpResult> =>
      ipcRenderer.invoke(CH.exportHtml, title, html),
    exportPdf: (title: string, html: string): Promise<OpResult> =>
      ipcRenderer.invoke(CH.exportPdf, title, html),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CH.openExternal, url)
  }
}

export type LuminaApi = typeof api
export type { FolderNode }

contextBridge.exposeInMainWorld('lumina', api)
