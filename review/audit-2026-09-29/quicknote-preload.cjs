const { contextBridge } = require('electron')
const draft = (id, text, updatedAt) => ({ id, text, savedText: text, filePath: `C:/audit/${id}.md`, cursor: 0, createdAt: 1, updatedAt, eol: 'lf', encoding: 'utf8', bom: false })
contextBridge.exposeInMainWorld('quicknote', {
  load: async () => ({ version: 1, buffers: [draft('A', 'ALPHA document', 1), draft('B', 'BRAVO document', 2)] }),
  persist: async () => {}, takePendingFiles: async () => [],
  onOpenFiles: () => {}, onFlush: () => {}, flushed: () => {},
  saveFile: async d => ({ ok: true, path: d.filePath }), saveAs: async () => ({ ok: false, cancelled: true }),
  close: () => {}, openDialog: async () => [], openPaths: async () => [], pathForFile: () => ''
})
