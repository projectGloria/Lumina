import { contextBridge, ipcRenderer } from 'electron'
import type { QuickApi } from '../shared/quicknoteSession'

const api: QuickApi = {
  load: () => ipcRenderer.invoke('qn:load'),
  persist: (session) => ipcRenderer.invoke('qn:persist', session),
  save: (draft) => ipcRenderer.invoke('qn:save', draft),
  close: () => ipcRenderer.send('qn:close'),
  onFlush: (callback) => { ipcRenderer.on('qn:flush', (_e, token) => callback(token)) },
  flushed: (token, error) => ipcRenderer.send('qn:flushed', token, error),
  exportSettings: (content: string) => ipcRenderer.invoke('qn:exportSettings', content),
  importSettings: () => ipcRenderer.invoke('qn:importSettings'),
  getFonts: () => ipcRenderer.invoke('qn:getFonts'),
  createDesktopShortcut: () => ipcRenderer.invoke('qn:createDesktopShortcut'),
  onNew: (callback) => { ipcRenderer.on('qn:new', () => callback()) }
}

contextBridge.exposeInMainWorld('quicknote', api)
