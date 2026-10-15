import { beforeEach, afterEach, expect, test, vi } from 'vitest'

vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), lumina: {} })
vi.stubGlobal('document', {
  documentElement: { dataset: {}, style: { [Symbol.iterator]: function* () {}, setProperty() {}, removeProperty() {} } },
  createElement: () => ({}), head: { appendChild() {} }
})
vi.stubGlobal('requestAnimationFrame', () => 0)

const { useEditor } = await import('../../src/renderer/src/store/editorStore')
const { useSettings, FALLBACK_SETTINGS } = await import('../../src/renderer/src/store/settingsStore')
const { useVault } = await import('../../src/renderer/src/store/vaultStore')
const { useWorkspace, WORKSPACE_INITIAL } = await import('../../src/renderer/src/store/workspaceStore')
const { closeTab, forgetPath, setIconOverride } = await import('../../src/renderer/src/lib/actions')

const buffer = (content: string, saved = content) => ({ content, saved, mtime: 1, loading: false })
beforeEach(() => {
  vi.useFakeTimers()
  useEditor.getState().reset()
  useSettings.setState({ settings: structuredClone(FALLBACK_SETTINGS) })
  useVault.setState({ vault: { path: 'C:/vault-A', name: 'A', lastOpened: 0 } })
  useWorkspace.setState({ ...WORKSPACE_INITIAL, hydrated: false, splitPath: null })
  window.lumina = { notes: { write: vi.fn(async () => ({ ok: true, mtime: 2 })) } } as any
})
afterEach(() => { useEditor.getState().reset(); vi.clearAllTimers(); vi.useRealTimers() })

test('reproduces a completed save from A modifying the buffer in B', async () => {
  let complete!: (value: any) => void
  window.lumina.notes.write = vi.fn(() => new Promise(resolve => { complete = resolve })) as any
  useEditor.setState({ buffers: { 'Note.md': buffer('A edited', 'A original') } })
  const save = useEditor.getState().save('Note.md')
  useEditor.getState().reset()
  useVault.setState({ vault: { path: 'C:/vault-B', name: 'B', lastOpened: 0 } })
  useEditor.setState({ buffers: { 'Note.md': buffer('B original') } })
  complete({ ok: true, mtime: 2 })
  await save
  expect(useEditor.getState().buffers['Note.md']).toMatchObject({ content: 'B original', saved: 'A edited' })
})

test('reproduces autosave overwriting an acknowledged external conflict', async () => {
  useEditor.setState({ buffers: { 'Note.md': buffer('original') } })
  useEditor.getState().setContent('Note.md', 'local edit')
  await useEditor.getState().externalChange('Note.md')
  await vi.advanceTimersByTimeAsync(401)
  expect(window.lumina.notes.write).toHaveBeenCalledWith('Note.md', 'local edit', 'C:/vault-A')
})

test('reproduces dirty buffer destruction on an external unlink', () => {
  useEditor.setState({ buffers: { 'Note.md': buffer('unsaved text', 'original') } })
  forgetPath('Note.md')
  expect(useEditor.getState().buffers['Note.md']).toBeUndefined()
  expect(window.lumina.notes.write).not.toHaveBeenCalled()
})

test('reproduces closing a tab releasing a buffer still shown in split view', async () => {
  useEditor.setState({ buffers: { 'Note.md': buffer('original') } })
  useWorkspace.setState({ tabs: [{ path: 'Note.md' }], splitPath: 'Note.md' } as any)
  await closeTab(0)
  expect(useWorkspace.getState().splitPath).toBe('Note.md')
  expect(useEditor.getState().buffers['Note.md']).toBeUndefined()
})

test('reproduces an override that cannot be cleared through its action', () => {
  setIconOverride('Note.md', 'star')
  setIconOverride('Note.md', null)
  expect(useSettings.getState().settings.iconOverrides['Note.md']).toBe('star')
})
