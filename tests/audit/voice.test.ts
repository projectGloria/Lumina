import { expect, test, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
const fixture = vi.hoisted(() => ({ callbacks: null as any, view: null as any }))
vi.mock('../../src/renderer/src/lib/recorder', () => ({
  startRecording: async () => ({ stream: {}, cancel() {} }), toWhisperWav: vi.fn()
}))
vi.mock('../../src/renderer/src/lib/liveDictation', () => ({
  startLiveDictation: (_stream: any, callbacks: any) => {
    fixture.callbacks = callbacks
    return { cancel() {}, finish: async () => {} }
  }
}))
vi.mock('../../src/renderer/src/editor/activeView', () => ({ getActiveView: () => fixture.view }))
vi.mock('../../src/renderer/src/store/workspaceStore', () => ({ activePath: () => 'Note.md' }))
vi.mock('../../src/renderer/src/store/settingsStore', () => ({ useSettings: { getState: () => ({
  settings: { voice: { liveDictation: true } }
}) } }))
vi.stubGlobal('window', { lumina: { voice: { liveStart: async () => null, liveStop: async () => {} } } })
const { startVoice, cancelVoice } = await import('../../src/renderer/src/lib/voice')

test('maps dictation spans through intervening edits', async () => {
  fixture.view = {
    state: EditorState.create({ doc: 'prefix ', selection: { anchor: 7 } }),
    dispatch(spec: any) { this.state = this.state.update(spec).state }
  }
  await startVoice('dictate')
  fixture.callbacks.onInterim('guess')
  fixture.view.dispatch({ changes: { from: 0, insert: 'NEW ' } })
  expect(fixture.view.state.doc.toString()).toBe('NEW prefix guess')
  fixture.callbacks.onFinal('final ')
  expect(fixture.view.state.doc.toString()).toBe('NEW prefix final  ')
  cancelVoice()
})
