import { expect, test, vi } from 'vitest'
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter(), app: {}, shell: {}, dialog: {}, BrowserWindow: class {} }
})
import { flushRenderer, setMainWindow } from '../../src/main/ipc'

test('rejects a flush timeout without an acknowledgement', async () => {
  vi.useFakeTimers()
  const send = vi.fn()
  setMainWindow({ isDestroyed: () => false, webContents: { send } } as any)
  const flush = flushRenderer(3000)
  const assertion = expect(flush).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(3000)
  await assertion
  expect(send).toHaveBeenCalledWith('app:resume', undefined)
  vi.useRealTimers()
})
