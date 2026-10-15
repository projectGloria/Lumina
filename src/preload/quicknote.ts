import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FileOpenResult, QuickApi } from '../shared/quicknoteSession'

const api: QuickApi = {
  load: () => ipcRenderer.invoke('qn:load'),
  persist: (session) => ipcRenderer.invoke('qn:persist', session),
  persistChanges: (buffers, order) => ipcRenderer.invoke('qn:persistChanges', buffers, order),
  saveFile: (draft) => ipcRenderer.invoke('qn:saveFile', draft),
  saveAs: (draft) => ipcRenderer.invoke('qn:saveAs', draft),
  close: () => ipcRenderer.send('qn:close'),
  onFlush: (callback) => { ipcRenderer.on('qn:flush', (_e, token) => callback(token)) },
  flushed: (token, error) => ipcRenderer.send('qn:flushed', token, error),
  openDialog: () => ipcRenderer.invoke('qn:openDialog'),
  openPaths: (paths) => ipcRenderer.invoke('qn:openPaths', paths),
  takePendingFiles: () => ipcRenderer.invoke('qn:pendingFiles'),
  onOpenFiles: (callback) => {
    ipcRenderer.on('qn:openFiles', (_e, results: FileOpenResult[]) => callback(results))
  },
  // A dropped `File` no longer carries a `path` property in a sandboxed
  // renderer; `webUtils` is the supported way to get one, and it has to be
  // called here because it comes from `electron`.
  pathForFile: (file) => webUtils.getPathForFile(file),
  exportSettings: (content: string) => ipcRenderer.invoke('qn:exportSettings', content),
  importSettings: () => ipcRenderer.invoke('qn:importSettings'),
  getFonts: () => ipcRenderer.invoke('qn:getFonts'),
  createDesktopShortcut: () => ipcRenderer.invoke('qn:createDesktopShortcut'),
  onNew: (callback) => { ipcRenderer.on('qn:new', () => callback()) }
}

contextBridge.exposeInMainWorld('quicknote', api)
