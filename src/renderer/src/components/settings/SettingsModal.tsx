import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../Icon'
import ThemeEditor, { SliderRow } from './ThemeEditor'
import { COMMANDS, hotkeyFor } from '../../lib/commands'
import { acceleratorChips, acceleratorFromEvent } from '../../lib/hotkeys'
import { useSettings } from '../../store/settingsStore'
import { toast, useUi } from '../../store/uiStore'
import { useVault } from '../../store/vaultStore'

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'editor', label: 'Editor', icon: 'edit' },
  { id: 'vault', label: 'Vault', icon: 'vault' },
  { id: 'hotkeys', label: 'Hotkeys', icon: 'keyboard' },
  { id: 'about', label: 'About', icon: 'info' }
]

export default function SettingsModal(): React.JSX.Element {
  const close = useUi((s) => s.closeModal)
  const tab = useUi((s) => s.settingsTab)
  const openSettings = useUi((s) => s.openSettings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="overlay center" onMouseDown={close}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-title">Settings</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-nav-item${tab === t.id ? ' is-active' : ''}`}
              onClick={() => openSettings(t.id)}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <button className="icon-btn settings-close" onClick={close} aria-label="Close settings">
            <Icon name="close" />
          </button>
          {tab === 'appearance' ? <ThemeEditor /> : null}
          {tab === 'editor' ? <EditorSettingsTab /> : null}
          {tab === 'vault' ? <VaultSettingsTab /> : null}
          {tab === 'hotkeys' ? <HotkeysTab /> : null}
          {tab === 'about' ? <AboutTab /> : null}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ editor */

function EditorSettingsTab(): React.JSX.Element {
  const editor = useSettings((s) => s.settings.editor)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof editor>): void => patch({ editor: p })

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Writing</h3>

        <ToggleRow
          label="Live preview"
          hint="Markdown renders as you type; markers show only on the line you are editing."
          value={editor.livePreview}
          onChange={(v) => set({ livePreview: v })}
        />
        <ToggleRow
          label="Serif headings"
          hint="Headings in a serif face against the sans interface, the way Claude sets text."
          value={editor.serifHeadings}
          onChange={(v) => set({ serifHeadings: v })}
        />
        <ToggleRow
          label="Continue lists on Enter"
          hint="Pressing Enter inside a list carries the bullet or number to the next line."
          value={editor.smartLists}
          onChange={(v) => set({ smartLists: v })}
        />
        <ToggleRow
          label="Check spelling"
          value={editor.spellcheck}
          onChange={(v) => set({ spellcheck: v })}
        />
        <ToggleRow
          label="Show line numbers"
          value={editor.showLineNumbers}
          onChange={(v) => set({ showLineNumbers: v })}
        />
        <ToggleRow
          label="Readable line length"
          hint="Keeps text to a comfortable measure instead of the full window width."
          value={editor.readableLineLength}
          onChange={(v) => set({ readableLineLength: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Typography</h3>
        <SliderRow
          label="Font size"
          value={editor.fontSize}
          min={12}
          max={26}
          step={1}
          suffix="px"
          onChange={(v) => set({ fontSize: v })}
        />
        <SliderRow
          label="Line height"
          value={editor.lineHeight}
          min={1.2}
          max={2.4}
          step={0.05}
          onChange={(v) => set({ lineHeight: v })}
        />
        <SliderRow
          label="Line width"
          hint="Only applies with readable line length on."
          value={editor.editorWidth}
          min={30}
          max={90}
          step={1}
          suffix="rem"
          onChange={(v) => set({ editorWidth: v })}
        />

        <TextRow
          label="Body font"
          hint="A CSS font stack. Leave empty for the system default."
          placeholder="ui-sans-serif, Segoe UI, sans-serif"
          value={editor.fontFamily}
          onChange={(v) => set({ fontFamily: v })}
        />
        <TextRow
          label="Heading font"
          placeholder="Iowan Old Style, Georgia, serif"
          value={editor.serifFamily}
          onChange={(v) => set({ serifFamily: v })}
        />
        <TextRow
          label="Monospace font"
          placeholder="Cascadia Code, Consolas, monospace"
          value={editor.monoFamily}
          onChange={(v) => set({ monoFamily: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Saving</h3>
        <SliderRow
          label="Autosave delay"
          hint="How long Lumina waits after you stop typing before writing to disk."
          value={editor.autosaveDelay}
          min={120}
          max={3000}
          step={20}
          suffix="ms"
          onChange={(v) => set({ autosaveDelay: v })}
        />
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------- vault */

function VaultSettingsTab(): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const vault = useVault((s) => s.vault)
  const index = useVault((s) => s.index)

  const notes = Object.values(index.notes)
  const words = notes.reduce((sum, n) => sum + n.wordCount, 0)
  const links = notes.reduce((sum, n) => sum + n.links.length, 0)

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">This vault</h3>
        <div className="vault-path">{vault?.path ?? 'No vault open'}</div>
        <div className="vault-stats">
          <Stat label="Notes" value={notes.length.toLocaleString()} />
          <Stat label="Words" value={words.toLocaleString()} />
          <Stat label="Links" value={links.toLocaleString()} />
          <Stat label="Tags" value={Object.keys(index.tags).length.toLocaleString()} />
          <Stat label="Unresolved" value={index.unresolved.length.toLocaleString()} />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Folders</h3>
        <TextRow
          label="Attachments"
          hint="Where pasted and dropped images are copied."
          value={settings.attachmentFolder}
          placeholder="attachments"
          onChange={(v) => patch({ attachmentFolder: v })}
        />
        <TextRow
          label="Templates"
          value={settings.templateFolder}
          placeholder="Templates"
          onChange={(v) => patch({ templateFolder: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Daily notes</h3>
        <TextRow
          label="Folder"
          value={settings.dailyNotes.folder}
          placeholder="Daily"
          onChange={(v) => patch({ dailyNotes: { folder: v } })}
        />
        <TextRow
          label="Date format"
          hint="YYYY, MM, DD, MMMM, DDDD, HH, mm."
          value={settings.dailyNotes.format}
          placeholder="YYYY-MM-DD"
          onChange={(v) => patch({ dailyNotes: { format: v } })}
        />
        <TextRow
          label="Template note"
          hint="Path to a note used as the starting point. Leave empty for none."
          value={settings.dailyNotes.template}
          placeholder="Templates/Daily.md"
          onChange={(v) => patch({ dailyNotes: { template: v } })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Performance</h3>
        <ToggleRow
          label="Lighter graph"
          hint="Fewer labels and a faster-settling simulation. Worth turning on past a few thousand notes."
          value={settings.graphPerformanceMode}
          onChange={(v) => patch({ graphPerformanceMode: v })}
        />
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- hotkeys */

// CodeMirror's own default/search keymaps bind these regardless of what is in
// COMMANDS, so the clash check above can't see them. A rebound Editor command
// always wins in the editor (its keymap is `Prec.highest`), but the built-in
// still fires everywhere else the accelerator would otherwise apply — worth a
// heads-up rather than a silent surprise.
const CM_BUILTIN_HOTKEYS: Record<string, string> = {
  'Ctrl+Z': 'CodeMirror: undo',
  'Ctrl+Shift+Z': 'CodeMirror: redo',
  'Ctrl+Y': 'CodeMirror: redo',
  'Ctrl+F': 'CodeMirror: find',
  'Ctrl+A': 'CodeMirror: select all',
  'Shift+Alt+Down': 'CodeMirror: duplicate line down'
}

function HotkeysTab(): React.JSX.Element {
  const overrides = useSettings((s) => s.settings.hotkeys)
  const patch = useSettings((s) => s.patch)
  const [recording, setRecording] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const accel = acceleratorFromEvent(e)
      if (!accel) return

      const clash = COMMANDS.find((c) => c.id !== recording && hotkeyFor(c) === accel)
      if (clash) {
        toast(`${accel} is already ${clash.title}`, 'error')
        setRecording(null)
        return
      }
      patch({ hotkeys: { ...overrides, [recording]: accel } })
      const builtin = CM_BUILTIN_HOTKEYS[accel]
      if (builtin) toast(`Note: ${accel} is also bound to ${builtin} outside the editor`)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, overrides, patch])

  const visible = COMMANDS.filter((c) =>
    filter ? c.title.toLowerCase().includes(filter.toLowerCase()) : true
  )

  return (
    <div className="settings-body">
      <section className="settings-section">
        <div className="settings-heading-row">
          <h3 className="settings-heading">Hotkeys</h3>
          <button
            className="btn btn-ghost btn-small"
            onClick={() => patch({ hotkeys: {} })}
            disabled={!Object.keys(overrides).length}
          >
            Reset all
          </button>
        </div>
        <input
          type="search"
          placeholder="Filter commands…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: '100%', marginBottom: 12 }}
        />

        {visible.map((command) => {
          const accel = hotkeyFor(command)
          const custom = overrides[command.id] !== undefined
          return (
            <div key={command.id} className="field-row hotkey-row">
              <div>
                <div className="field-label">{command.title}</div>
                <div className="field-hint">{command.section}</div>
              </div>
              <div className="field-control">
                <button
                  className={`hotkey-chip${recording === command.id ? ' is-recording' : ''}`}
                  onClick={() => setRecording(command.id)}
                >
                  {recording === command.id ? (
                    'Press keys…'
                  ) : accel ? (
                    acceleratorChips(accel).map((k) => <kbd key={k}>{k}</kbd>)
                  ) : (
                    <span className="hotkey-none">Not set</span>
                  )}
                </button>
                {custom ? (
                  <button
                    className="icon-btn"
                    title="Restore the default"
                    onClick={() => {
                      const next = { ...overrides }
                      delete next[command.id]
                      patch({ hotkeys: next })
                    }}
                  >
                    <Icon name="refresh" size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------- about */

function AboutTab(): React.JSX.Element {
  return (
    <div className="settings-body">
      <section className="settings-section about">
        <div className="welcome-mark">
          <Icon name="book" size={24} />
        </div>
        <h3 className="settings-heading">Lumina</h3>
        <p className="field-hint">
          A local note app. Your vault is a folder of plain markdown files — Lumina never moves
          them anywhere else, and everything it stores about them lives in a <code>.lumina</code>
          folder beside them.
        </p>
        <p className="field-hint">
          Notes are yours in a format that outlives this app. If you stop using Lumina tomorrow,
          every file still opens in any editor you like.
        </p>
        <p className="field-hint">
          Settings, themes and layout are per-vault, so a vault you copy to another machine brings
          its look with it.
        </p>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ shared */

function ToggleRow({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        <button
          className={`switch${value ? ' on' : ''}`}
          role="switch"
          aria-checked={value}
          aria-label={label}
          onClick={() => onChange(!value)}
        />
      </div>
    </div>
  )
}

function TextRow({
  label,
  hint,
  value,
  placeholder,
  onChange
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          style={{ width: 230 }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(draft.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onChange(draft.trim())
          }}
        />
      </div>
    </div>
  )
}
