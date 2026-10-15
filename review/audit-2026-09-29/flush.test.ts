import { expect, test, vi } from 'vitest'
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter(), app: {}, shell: {}, dialog: {}, BrowserWindow: class {} }
})
import { flushRenderer, setMainWindow } from '../../src/main/ipc'

test('reproduces flush timeout resolving successfully without an acknowledgement', async () => {
  vi.useFakeTimers()
  const send = vi.fn()
  setMainWindow({ isDestroyed: () => false, webContents: { send } } as any)
  let completed = false
  const flush = flushRenderer().then(() => { completed = true })
  expect(completed).toBe(false)
  await vi.advanceTimersByTimeAsync(3000)
  await flush
  expect(send).toHaveBeenCalledOnce()
  expect(completed).toBe(true)
  vi.useRealTimers()
})
