import { useCallback, useEffect, useState } from 'react'
import { Icon, type IconName } from '../Icon'
import ThemeEditor, { SliderRow } from './ThemeEditor'
import MicTester from './MicTester'
import SpeechPacks from './SpeechPacks'
import { COMMANDS, hotkeyFor, runCommand } from '../../lib/commands'
import { SLASH_ITEMS } from '../../editor/slashCommands'
import { acceleratorChips, acceleratorFromEvent } from '../../lib/hotkeys'
import { listVoices, onVoicesChanged, previewVoice, speechAvailable, stopReading } from '../../lib/readAloud'
import { slashCommandName } from '@shared/template'
import { WHISPER_LANGUAGES } from '@shared/audio'
import type {
  ClipperStatus,
  CustomSlashCommand,
  SettingsPreset,
  VoiceToolStatus
} from '@shared/types'
import { defaultLayout } from '../../home/widgets/defaults'
import { WIDGETS } from '../../home/widgets'
import { useHome } from '../../store/homeStore'
import { FALLBACK_SETTINGS, useSettings } from '../../store/settingsStore'
import { toast, useUi } from '../../store/uiStore'
import { useMusic } from '../../store/musicStore'
import { useVault } from '../../store/vaultStore'

type FontFamilyPreset = 'sans' | 'serif' | 'mono' | 'custom'

const FONT_FAMILY_PRESETS: Record<Exclude<FontFamilyPreset, 'custom'>, string> = {
  sans: 'ui-sans-serif, Segoe UI, Helvetica Neue, Arial, sans-serif',
  serif: 'Iowan Old Style, Georgia, Cambria, serif',
  mono: 'Cascadia Code, Consolas, ui-monospace, monospace'
}

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'editor', label: 'Editor', icon: 'edit' },
  { id: 'slash', label: 'Slash commands', icon: 'slash' },
  { id: 'quick', label: 'Quick note', icon: 'bolt' },
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
  { id: 'music', label: 'Music', icon: 'speaker' },
  { id: 'clipper', label: 'Web clipper', icon: 'globe' },
  { id: 'vault', label: 'Vault', icon: 'vault' },
  { id: 'profiles', label: 'Settings profiles', icon: 'settings' },
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
              data-tooltip={`Open ${t.label} settings`}
              onClick={() => openSettings(t.id)}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <button className="icon-btn settings-close" onClick={close} data-tooltip="Close" aria-label="Close settings">
            <Icon name="close" />
          </button>
          {tab === 'appearance' ? <ThemeEditor /> : null}
          {tab === 'editor' ? <EditorSettingsTab /> : null}
          {tab === 'slash' ? <SlashCommandsTab /> : null}
          {tab === 'quick' ? <QuickNoteTab /> : null}
          {tab === 'home' ? <HomeTab /> : null}
          {tab === 'voice' ? <VoiceTab /> : null}
          {tab === 'music' ? <MusicTab /> : null}
          {tab === 'clipper' ? <ClipperTab /> : null}
          {tab === 'vault' ? <VaultSettingsTab /> : null}
          {tab === 'profiles' ? <SettingsProfilesTab /> : null}
          {tab === 'hotkeys' ? <HotkeysTab /> : null}
          {tab === 'about' ? <AboutTab /> : null}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- music */

function MusicTab(): React.JSX.Element {
  const music = useSettings((s) => s.settings.music)
  const patch = useSettings((s) => s.patch)
  const vault = useVault((s) => s.vault)
  const tracks = useMusic((s) => s.tracks)
  const library = useMusic((s) => s.library)
  const load = useMusic((s) => s.load)

  // The count is whatever the player already read. Opening this tab does not
  // walk the folder — that happens when the player is opened, and a settings
  // pane is not a reason to touch twenty thousand files.
  const counted = library === 'ready' || library === 'unreachable'

  /**
   * A music folder inside the vault is not forbidden, but the vault indexes
   * what is under it, so the explorer fills with audio files and the search
   * index carries them. Better said out loud than quietly prevented.
   */
  const insideVault =
    !!vault && !!music.folder && music.folder.toLowerCase().startsWith(vault.path.toLowerCase())

  const choose = (): void => {
    void (async () => {
      const folder = await window.lumina.music.pick()
      if (!folder) return
      patch({ music: { ...music, folder, lastTrack: undefined, lastPosition: undefined } })
      await load(true)
    })()
  }

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Music</h3>
        <p className="voice-blurb">
          A folder of your own music, played inside Lumina. It is not part of any vault: it is
          never indexed, never watched, and never shown in the explorer, and nothing about it is
          read until you open the player. Like your hotkeys, the folder belongs to this machine
          rather than to a vault, so the music keeps playing when you switch between them.
        </p>

        <div className="field-row">
          <div>
            <div className="field-label">Music folder</div>
            <div className="field-hint">
              {music.folder ? (
                <code>{music.folder}</code>
              ) : (
                'None chosen. The player stays out of the way until there is one.'
              )}
            </div>
            {music.folder && counted ? (
              <div className="field-hint">
                {library === 'unreachable'
                  ? 'Cannot be reached at the moment — an unmounted drive or share looks like this.'
                  : `${tracks.length.toLocaleString()} track${tracks.length === 1 ? '' : 's'}`}
              </div>
            ) : null}
            {insideVault ? (
              <div className="field-hint">
                This folder is inside the open vault, so the vault will index and show these files
                as well. A folder outside it keeps the two apart.
              </div>
            ) : null}
          </div>
          <div className="field-control">
            <button className="btn btn-small" onClick={choose}>
              <Icon name="folder" size={14} />
              <span>{music.folder ? 'Change' : 'Open music vault'}</span>
            </button>
            {music.folder ? (
              <button
                className="btn btn-small btn-danger"
                onClick={() =>
                  patch({
                    music: { ...music, folder: '', lastTrack: undefined, lastPosition: undefined }
                  })
                }
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------- home */

function HomeTab(): React.JSX.Element {
  const home = useSettings((s) => s.settings.home)
  const patch = useSettings((s) => s.patch)
  const widgets = useHome((s) => s.layout.widgets)
  const columns = useHome((s) => s.layout.columns)
  const commit = useHome((s) => s.commit)
  const close = useUi((s) => s.closeModal)

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Home</h3>
        <p className="voice-blurb">
          A dashboard of widgets, one per vault. The arrangement lives in this vault&rsquo;s
          <code>.lumina/home.json</code>, so a board follows the notes it is about rather than the
          machine you built it on.
        </p>

        <ToggleRow
          label="Open Home on launch"
          hint="Only when there are no notes to restore — Home never displaces the note you left open."
          value={home.openOnLaunch}
          defaultValue={FALLBACK_SETTINGS.home.openOnLaunch}
          onChange={(v) => patch({ home: { openOnLaunch: v } })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">This vault&rsquo;s board</h3>
        <div className="field-row">
          <div>
            <div className="field-label">
              {widgets.length} widget{widgets.length === 1 ? '' : 's'}, {columns} columns wide
            </div>
            <div className="field-hint">
              Widgets are moved, resized and added from the board itself — open Home and choose
              Edit layout.
            </div>
          </div>
          <div className="field-control">
            <button
              className="btn btn-small"
              onClick={() => {
                close()
                runCommand('home.editLayout')
              }}
            >
              Edit layout
            </button>
            <button
              className="btn btn-small btn-danger"
              onClick={() =>
                useUi.getState().showConfirm({
                  title: 'Reset this board?',
                  body: 'The widgets you arranged are replaced by the starter board. Nothing in your notes changes.',
                  confirmLabel: 'Reset board',
                  danger: true,
                  onConfirm: () => {
                    const seed = defaultLayout()
                    commit(seed.widgets, seed.columns)
                  }
                })
              }
            >
              Reset to the starter board
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Available widgets</h3>
        <p className="voice-blurb">
          Every one of these reads what Lumina already has open. None of them reaches the network:
          with link previews off, Lumina still makes no requests at all.
        </p>
        <ul className="settings-widget-list">
          {WIDGETS.map((def) => (
            <li key={def.type} className="settings-widget">
              <Icon name={def.icon} size={15} className="settings-widget-icon" />
              <div>
                <div className="field-label">{def.name}</div>
                <div className="field-hint">{def.description}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ----------------------------------------------------------------- clipper */

function ClipperTab(): React.JSX.Element {
  const clipper = useSettings((s) => s.settings.clipper)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof clipper>): void => patch({ clipper: p })
  const [status, setStatus] = useState<ClipperStatus | null>(null)
  const [revealed, setRevealed] = useState(false)

  const check = useCallback(() => {
    void window.lumina.clipper.status().then(setStatus)
  }, [])
  // Re-checked after anything that restarts the listener, so the panel reflects
  // what is actually bound rather than what was asked for.
  useEffect(check, [check, clipper.enabled, clipper.port, clipper.token])

  /** Turning it on for the first time is also what mints the token. */
  const toggle = async (on: boolean): Promise<void> => {
    if (on && !clipper.token) set({ enabled: true, token: await window.lumina.clipper.regenerateToken() })
    else set({ enabled: on })
  }

  const regenerate = async (): Promise<void> => {
    set({ token: await window.lumina.clipper.regenerateToken() })
    setRevealed(true)
    toast('New token — paste it into the extension again', 'info')
  }

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Web clipper</h3>
        <p className="voice-blurb">
          Clip pages from your browser straight into this vault. Lumina listens
          on <code>127.0.0.1</code> only, behind a token, and accepts nothing
          from the open web — the listener is closed until you switch it on.
        </p>

        <ToggleRow
          label="Accept clips"
          hint="Opens a local port for the browser extension. The only inbound connection Lumina makes."
          value={clipper.enabled}
          defaultValue={false}
          onChange={(v) => void toggle(v)}
        />

        {clipper.enabled ? (
          <div className={`voice-status${status?.running ? ' is-ready' : ''}`}>
            <Icon name={status?.running ? 'check' : 'info'} size={15} />
            <div>
              <div className="voice-status-title">
                {status === null
                  ? 'Checking…'
                  : status.running
                    ? `Listening on 127.0.0.1:${status.port}`
                    : 'Not listening'}
              </div>
              {status?.error ? <div className="voice-status-detail">{status.error}</div> : null}
            </div>
            <button className="voice-btn" onClick={check} data-tooltip="Check again">
              <Icon name="refresh" size={13} />
              Recheck
            </button>
          </div>
        ) : null}

        <NumberRow
          label="Port"
          hint="Must match the extension's Options page."
          value={clipper.port}
          defaultValue={41999}
          onChange={(v) => set({ port: v })}
        />

        <div className="field-row">
          <div>
            <div className="field-label">Token</div>
            <div className="field-hint">
              Paste this into the extension. Regenerating it locks out any browser still holding the old one.
            </div>
          </div>
          <div className="field-control clip-token">
            <input
              readOnly
              type={revealed ? 'text' : 'password'}
              value={clipper.token}
              placeholder="Switch the clipper on to generate one"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="voice-btn"
              onClick={() => setRevealed((v) => !v)}
              data-tooltip={revealed ? 'Hide the token' : 'Show the token'}
            >
              {revealed ? 'Hide' : 'Show'}
            </button>
            <button
              className="voice-btn"
              disabled={!clipper.token}
              onClick={() => {
                void navigator.clipboard.writeText(clipper.token)
                toast('Token copied')
              }}
              data-tooltip="Copy the token"
            >
              Copy
            </button>
            <button className="voice-btn" onClick={() => void regenerate()} data-tooltip="Issue a new token">
              New
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Clips</h3>
        <TextRow
          label="Folder"
          hint="Vault-relative folder clipped pages are filed in."
          value={clipper.folder}
          defaultValue="Clippings"
          placeholder="Clippings"
          onChange={(v) => set({ folder: v })}
        />
        <TextRow
          label="Tags"
          hint="Added to every clip, on top of whatever you type in the extension."
          value={clipper.tags.join(', ')}
          defaultValue="clipped"
          placeholder="clipped"
          onChange={(v) =>
            set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })
          }
        />
        <ToggleRow
          label="Download images"
          hint="Copy a page's images into the vault so the clip still reads with no network."
          value={clipper.downloadImages}
          defaultValue
          onChange={(v) => set({ downloadImages: v })}
        />
        <ToggleRow
          label="Open each clip"
          hint="Open a clipped page in a tab as it arrives."
          value={clipper.openOnClip}
          defaultValue
          onChange={(v) => set({ openOnClip: v })}
        />
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------- voice */

function VoiceTab(): React.JSX.Element {
  const voice = useSettings((s) => s.settings.voice)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof voice>): void => patch({ voice: p })
  const [status, setStatus] = useState<VoiceToolStatus | null>(null)

  // Re-checked whenever the paths change, because the whole point of the panel
  // is telling the user whether what they installed was actually found.
  const check = useCallback(() => {
    void window.lumina.voice.status().then(setStatus)
  }, [])
  useEffect(check, [check, voice.binaryPath, voice.modelPath])

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Input</h3>
        <MicTester />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Recording</h3>
        <TextRow
          label="Recordings folder"
          hint="Vault-relative folder voice notes are saved into."
          value={voice.folder}
          defaultValue="attachments/voice"
          placeholder="attachments/voice"
          onChange={(v) => set({ folder: v })}
        />
        <ToggleRow
          label="Keep the audio"
          hint="Save the recording and embed a player. With this off a voice note leaves only its transcript."
          value={voice.keepAudio}
          defaultValue
          onChange={(v) => set({ keepAudio: v })}
        />
        <ToggleRow
          label="Write as I speak"
          hint="Dictation inserts each sentence as you pause, instead of everything when you stop. Keeps a speech process running while you dictate."
          value={voice.liveDictation}
          defaultValue
          onChange={(v) => set({ liveDictation: v })}
        />
        <ToggleRow
          label="Transcribe recordings"
          hint="Run a voice note through the local speech model and write the text under the player."
          value={voice.transcribe}
          defaultValue
          onChange={(v) => set({ transcribe: v })}
        />
        <SelectRow
          label="Language"
          hint="Naming the language is more accurate than letting the model guess, especially on short clips."
          value={voice.language || 'auto'}
          defaultValue="auto"
          options={[
            { value: 'auto', label: 'Detect automatically' },
            ...WHISPER_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name }))
          ]}
          onChange={(v) => set({ language: v })}
        />
      </section>

      <ReadAloudSection />

      <SpeechPacks onChanged={check} />

      <section className="settings-section">
        <h3 className="settings-heading">Speech model</h3>
        <p className="voice-blurb">
          Transcription runs entirely on this machine through a local{' '}
          <code>whisper.cpp</code> build, so nothing you record is ever sent
          anywhere. Lumina does not ship one: put the executable and a{' '}
          <code>.bin</code> model in the folder below, or point at them directly.
        </p>

        <div className={`voice-status${status?.available ? ' is-ready' : ''}`}>
          <Icon name={status?.available ? 'check' : 'info'} size={15} />
          <div>
            <div className="voice-status-title">
              {status === null
                ? 'Checking…'
                : status.available
                  ? 'Speech model ready'
                  : 'No speech model installed'}
            </div>
            {status ? (
              <div className="voice-status-detail">
                {status.available ? status.model : status.reason}
              </div>
            ) : null}
            {status && !status.available ? (
              <div className="voice-status-detail">{status.folder}</div>
            ) : null}
          </div>
          <button className="voice-btn" onClick={check} data-tooltip="Look again">
            <Icon name="refresh" size={13} />
            Recheck
          </button>
        </div>

        <TextRow
          label="Whisper executable"
          hint="Leave empty to look in the folder above."
          value={voice.binaryPath}
          defaultValue=""
          placeholder="Auto-detect"
          onChange={(v) => set({ binaryPath: v.trim() })}
        />
        <TextRow
          label="Model file"
          hint="Leave empty to use the largest .bin found in the folder above."
          value={voice.modelPath}
          defaultValue=""
          placeholder="Auto-detect"
          onChange={(v) => set({ modelPath: v.trim() })}
        />
      </section>
    </div>
  )
}

/**
 * Read aloud, which is the half of "voice" that needs nothing installed: the
 * voices listed here are the operating system's own.
 */
function ReadAloudSection(): React.JSX.Element {
  const readAloud = useSettings((s) => s.settings.voice.readAloud)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof readAloud>): void => patch({ voice: { readAloud: p } })
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  // Chromium fills the voice list asynchronously, so a first read right after a
  // cold start legitimately comes back empty — hence the subscription rather
  // than a single call.
  useEffect(() => {
    const load = (): void => setVoices(listVoices())
    load()
    return onVoicesChanged(load)
  }, [])

  // Stop any preview on the way out, or closing settings leaves a voice
  // talking to an empty screen.
  useEffect(() => stopReading, [])

  const available = speechAvailable()

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Read aloud</h3>
      <p className="voice-blurb">
        Select text anywhere — the editor, read mode — and press{' '}
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> to hear it, or right-click
        the selection. With nothing selected the whole note is read. The voices
        are the ones installed on this computer, so this works offline and needs
        no speech model.
      </p>

      <SelectRow
        label="Voice"
        hint={
          available
            ? 'Windows adds more under Settings › Time & language › Speech.'
            : 'This build has no speech voices available.'
        }
        value={readAloud.voice}
        defaultValue=""
        options={[
          { value: '', label: 'System default' },
          ...voices.map((voice) => ({
            value: voice.voiceURI,
            label: `${voice.name} (${voice.lang})`
          }))
        ]}
        onChange={(v) => set({ voice: v })}
      />
      <SliderRow
        label="Speed"
        hint="1 is the voice's own pace."
        value={readAloud.rate}
        min={0.5}
        max={2}
        step={0.05}
        suffix="×"
        defaultValue={1}
        onChange={(v) => set({ rate: v })}
      />
      <SliderRow
        label="Pitch"
        hint="Some system voices ignore this."
        value={readAloud.pitch}
        min={0}
        max={2}
        step={0.1}
        defaultValue={1}
        onChange={(v) => set({ pitch: v })}
      />
      <SliderRow
        label="Volume"
        value={readAloud.volume}
        min={0}
        max={1}
        step={0.05}
        defaultValue={1}
        onChange={(v) => set({ volume: v })}
      />

      <div className="settings-row-buttons">
        <button className="voice-btn" onClick={previewVoice} disabled={!available}>
          <Icon name="play" size={13} />
          Preview
        </button>
        <button className="voice-btn" onClick={stopReading}>
          <Icon name="stop" size={13} />
          Stop
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ editor */

function EditorSettingsTab(): React.JSX.Element {
  const editor = useSettings((s) => s.settings.editor)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof editor>): void => patch({ editor: p })
  const [fonts, setFonts] = useState<string[]>([])

  useEffect(() => {
    let live = true
    void window.lumina.settings.fonts().then((installed) => {
      if (live) setFonts(installed)
    })
    return () => { live = false }
  }, [])

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Writing</h3>

        <ToggleRow
          label="Live preview"
          hint="Markdown renders as you type; markers show only on the line you are editing."
          value={editor.livePreview}
          defaultValue={FALLBACK_SETTINGS.editor.livePreview}
          onChange={(v) => set({ livePreview: v })}
        />
        <ToggleRow
          label="Serif headings"
          hint="Headings in a serif face against the sans interface, the way Claude sets text."
          value={editor.serifHeadings}
          defaultValue={FALLBACK_SETTINGS.editor.serifHeadings}
          onChange={(v) => set({ serifHeadings: v })}
        />
        <ToggleRow
          label="Continue lists on Enter"
          hint="Pressing Enter inside a list carries the bullet or number to the next line."
          value={editor.smartLists}
          defaultValue={FALLBACK_SETTINGS.editor.smartLists}
          onChange={(v) => set({ smartLists: v })}
        />
        <ToggleRow
          label="Check spelling"
          value={editor.spellcheck}
          defaultValue={FALLBACK_SETTINGS.editor.spellcheck}
          onChange={(v) => set({ spellcheck: v })}
        />
        <ToggleRow
          label="Show line numbers"
          value={editor.showLineNumbers}
          defaultValue={FALLBACK_SETTINGS.editor.showLineNumbers}
          onChange={(v) => set({ showLineNumbers: v })}
        />
        <ToggleRow
          label="Fetch link previews"
          hint="A link alone on its line is drawn as a card. With this on, Lumina asks the page for its title, description and thumbnail - the only time it touches the network. Off, cards are built from the address alone."
          value={editor.linkPreviews}
          defaultValue={FALLBACK_SETTINGS.editor.linkPreviews}
          onChange={(v) => set({ linkPreviews: v })}
        />
        <ToggleRow
          label="Readable line length"
          hint="Keeps text to a comfortable measure instead of the full window width."
          value={editor.readableLineLength}
          defaultValue={FALLBACK_SETTINGS.editor.readableLineLength}
          onChange={(v) => set({ readableLineLength: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Typography</h3>
        <SliderRow
          label="Font size"
          value={editor.fontSize}
          defaultValue={FALLBACK_SETTINGS.editor.fontSize}
          min={12}
          max={26}
          step={1}
          suffix="px"
          onChange={(v) => set({ fontSize: v })}
        />
        <SliderRow
          label="Line height"
          value={editor.lineHeight}
          defaultValue={FALLBACK_SETTINGS.editor.lineHeight}
          min={1.2}
          max={2.4}
          step={0.05}
          onChange={(v) => set({ lineHeight: v })}
        />
        <SliderRow
          label="Line width"
          hint="Only applies with readable line length on."
          value={editor.editorWidth}
          defaultValue={FALLBACK_SETTINGS.editor.editorWidth}
          min={30}
          max={90}
          step={1}
          suffix="rem"
          onChange={(v) => set({ editorWidth: v })}
        />

        <SegmentedRow
          label="Body font family"
          hint="Quick presets for the body font stack below."
          value={
            Object.entries(FONT_FAMILY_PRESETS).find(([, stack]) => stack === editor.fontFamily)?.[0] ??
            'custom'
          }
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' }
          ]}
          onChange={(v: Exclude<FontFamilyPreset, 'custom'>) => set({ fontFamily: FONT_FAMILY_PRESETS[v] })}
        />
        <FontRow
          label="Body font"
          hint={`${fonts.length || 'Loading'} installed font families available.`}
          value={editor.fontFamily}
          fonts={fonts}
          defaultValue={FALLBACK_SETTINGS.editor.fontFamily}
          onChange={(v) => set({ fontFamily: v })}
        />
        <FontRow
          label="Heading font"
          value={editor.serifFamily}
          fonts={fonts}
          defaultValue={FALLBACK_SETTINGS.editor.serifFamily}
          onChange={(v) => set({ serifFamily: v })}
        />
        <FontRow
          label="Monospace font"
          value={editor.monoFamily}
          fonts={fonts}
          defaultValue={FALLBACK_SETTINGS.editor.monoFamily}
          onChange={(v) => set({ monoFamily: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Saving</h3>
        <SliderRow
          label="Autosave delay"
          hint="How long Lumina waits after you stop typing before writing to disk."
          value={editor.autosaveDelay}
          defaultValue={FALLBACK_SETTINGS.editor.autosaveDelay}
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

/* --------------------------------------------------------- slash commands */

/** Names the built-in `/` menu already uses, matched case-insensitively. */
const BUILTIN_SLASH_NAMES = new Set(SLASH_ITEMS.map((item) => item.label.toLowerCase()))

function SlashCommandsTab(): React.JSX.Element {
  const commands = useSettings((s) => s.settings.slashCommands)
  const patch = useSettings((s) => s.patch)

  const update = (id: string, fields: Partial<CustomSlashCommand>): void =>
    patch({ slashCommands: commands.map((c) => (c.id === id ? { ...c, ...fields } : c)) })

  const remove = (id: string): void =>
    patch({ slashCommands: commands.filter((c) => c.id !== id) })

  const add = (): void =>
    patch({
      slashCommands: [
        ...commands,
        { id: crypto.randomUUID(), name: '', description: '', body: '' }
      ]
    })

  return (
    <div className="settings-body">
      <section className="settings-section">
        <div className="settings-heading-row">
          <h3 className="settings-heading">Your slash commands</h3>
          <button className="btn btn-ghost btn-small" onClick={add} data-tooltip="Add a command">
            Add command
          </button>
        </div>
        <p className="field-hint">
          Type <code>/</code> in a note to reach these alongside the built-in ones. A body can
          carry <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{title}}'}</code>{' '}
          and <code>{'{{cursor}}'}</code> — the caret lands where <code>{'{{cursor}}'}</code> is,
          or at the end if you leave it out. They are stored with your hotkeys rather than in the
          vault, so they follow you everywhere.
        </p>

        {commands.length === 0 ? (
          <p className="field-hint">No commands of your own yet.</p>
        ) : (
          commands.map((command) => (
            <SlashCommandCard
              key={command.id}
              command={command}
              siblings={commands}
              onChange={(fields) => update(command.id, fields)}
              onRemove={() => remove(command.id)}
            />
          ))
        )}
      </section>
    </div>
  )
}

function SlashCommandCard({
  command,
  siblings,
  onChange,
  onRemove
}: {
  command: CustomSlashCommand
  siblings: CustomSlashCommand[]
  onChange: (fields: Partial<CustomSlashCommand>) => void
  onRemove: () => void
}): React.JSX.Element {
  const [name, setName] = useState(command.name)
  const [description, setDescription] = useState(command.description)
  const [body, setBody] = useState(command.body)

  useEffect(() => setName(command.name), [command.name])
  useEffect(() => setDescription(command.description), [command.description])
  useEffect(() => setBody(command.body), [command.body])

  // Only checked once the name has settled, so it doesn't flicker mid-typing.
  const clean = slashCommandName(command.name)
  const duplicate =
    clean &&
    (BUILTIN_SLASH_NAMES.has(clean.toLowerCase()) ||
      siblings.some((c) => c.id !== command.id && slashCommandName(c.name).toLowerCase() === clean.toLowerCase()))

  return (
    <div className="slash-card">
      <div className="slash-card-head">
        <span className="slash-card-prefix">/</span>
        <input
          type="text"
          className="slash-card-name"
          value={name}
          placeholder="name"
          spellCheck={false}
          aria-label="Command name"
          onChange={(e) => {
            setName(e.target.value)
            onChange({ name: e.target.value })
          }}
          onBlur={() => onChange({ name: slashCommandName(name) })}
        />
        <input
          type="text"
          className="slash-card-desc"
          value={description}
          placeholder="What it inserts"
          aria-label="Command description"
          onChange={(e) => {
            setDescription(e.target.value)
            onChange({ description: e.target.value })
          }}
          onBlur={() => onChange({ description: description.trim() })}
        />
        <button className="icon-btn" data-tooltip="Delete this command" aria-label="Delete command" onClick={onRemove}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      <textarea
        className="slash-card-body"
        value={body}
        rows={4}
        placeholder={'## {{title}}\n\n{{cursor}}'}
        spellCheck={false}
        aria-label="Snippet body"
        onChange={(e) => {
          setBody(e.target.value)
          onChange({ body: e.target.value })
        }}
        onBlur={() => onChange({ body })}
      />
      {duplicate ? (
        <div className="field-hint slash-card-warning">
          Another command already answers to <code>/{clean}</code>; the first one in this list wins.
        </div>
      ) : null}
      {!clean ? <div className="field-hint slash-card-warning">Give this one a name to reach it.</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------- quick note */

function QuickNoteTab(): React.JSX.Element {
  const quickNote = useSettings((s) => s.settings.quickNote)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof quickNote>): void => patch({ quickNote: p })
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      const accel = acceleratorFromEvent(e)
      // A bare key would fire in every application you use; the OS-wide
      // shortcut needs a modifier to be liveable.
      if (!accel || !/\+/.test(accel)) return
      set({ accelerator: accel })
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Quick note</h3>
        <p className="field-hint">
          A blank note, instantly, from anywhere — even with Lumina in the background. Notes land
          in the folder below, in their own tab, named for the moment you took them.
        </p>

        <div className="field-row">
          <div>
            <div className="field-label">Global shortcut</div>
            <div className="field-hint">
              Works system-wide. Left and right modifiers are the same key to the OS, so this
              answers to either Ctrl and either Shift.
            </div>
          </div>
          <div className="field-control">
            <DefaultButton
              label="Global shortcut"
              onClick={() => set({ accelerator: FALLBACK_SETTINGS.quickNote.accelerator })}
            />
            <button
              className={`hotkey-chip${recording ? ' is-recording' : ''}`}
              onClick={() => setRecording(true)}
            >
              {recording ? (
                'Press keys…'
              ) : quickNote.accelerator ? (
                acceleratorChips(quickNote.accelerator).map((k) => <kbd key={k}>{k}</kbd>)
              ) : (
                <span className="hotkey-none">Off</span>
              )}
            </button>
            {quickNote.accelerator ? (
              <button
                className="icon-btn"
                data-tooltip="Turn the global shortcut off"
                aria-label="Turn the global shortcut off"
                onClick={() => set({ accelerator: '' })}
              >
                <Icon name="close" size={13} />
              </button>
            ) : null}
          </div>
        </div>

        <TextRow
          label="Folder"
          hint="Created on the first quick note if it is not there yet."
          value={quickNote.folder}
          defaultValue={FALLBACK_SETTINGS.quickNote.folder}
          placeholder="Temporary"
          onChange={(v) => set({ folder: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Staying reachable</h3>
        <ToggleRow
          label="Start with the system"
          hint="Lumina starts in the tray at login — no window, no vault opened — so the shortcut works from boot."
          value={quickNote.startAtLogin}
          defaultValue={FALLBACK_SETTINGS.quickNote.startAtLogin}
          onChange={(v) => set({ startAtLogin: v })}
        />
        <ToggleRow
          label="Keep running in the tray"
          hint="Closing the window hides it instead of quitting. Quit for real from the tray icon."
          value={quickNote.closeToTray}
          defaultValue={FALLBACK_SETTINGS.quickNote.closeToTray}
          onChange={(v) => set({ closeToTray: v })}
        />
        <ToggleRow
          label="Keep the window warm"
          hint="Builds the window while idling in the tray so even the first note opens instantly. Costs memory the rest of the time; leave it off if you want the tray to stay cheap."
          value={quickNote.preloadWindow}
          defaultValue={FALLBACK_SETTINGS.quickNote.preloadWindow}
          onChange={(v) => set({ preloadWindow: v })}
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
          defaultValue={FALLBACK_SETTINGS.attachmentFolder}
          placeholder="attachments"
          onChange={(v) => patch({ attachmentFolder: v })}
        />
        <TextRow
          label="Templates"
          value={settings.templateFolder}
          defaultValue={FALLBACK_SETTINGS.templateFolder}
          placeholder="Templates"
          onChange={(v) => patch({ templateFolder: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Daily notes</h3>
        <TextRow
          label="Folder"
          value={settings.dailyNotes.folder}
          defaultValue={FALLBACK_SETTINGS.dailyNotes.folder}
          placeholder="Daily"
          onChange={(v) => patch({ dailyNotes: { folder: v } })}
        />
        <TextRow
          label="Date format"
          hint="YYYY, MM, DD, MMMM, DDDD, HH, mm."
          value={settings.dailyNotes.format}
          defaultValue={FALLBACK_SETTINGS.dailyNotes.format}
          placeholder="YYYY-MM-DD"
          onChange={(v) => patch({ dailyNotes: { format: v } })}
        />
        <TextRow
          label="Template note"
          hint="Path to a note used as the starting point. Leave empty for none."
          value={settings.dailyNotes.template}
          defaultValue={FALLBACK_SETTINGS.dailyNotes.template}
          placeholder="Templates/Daily.md"
          onChange={(v) => patch({ dailyNotes: { template: v } })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Explorer</h3>
        <SegmentedRow
          label="Size"
          hint="Row height, label and icon size in the file explorer."
          value={settings.explorerSize}
          defaultValue={FALLBACK_SETTINGS.explorerSize}
          options={[
            { value: 'compact' as const, label: 'Compact' },
            { value: 'default' as const, label: 'Default' },
            { value: 'large' as const, label: 'Large' }
          ]}
          onChange={(v) => patch({ explorerSize: v })}
        />
        <ToggleRow
          label="Always show folder counts"
          hint="Keep the note count beside a folder visible instead of only while hovering it."
          value={settings.alwaysShowFolderCount}
          defaultValue={FALLBACK_SETTINGS.alwaysShowFolderCount}
          onChange={(v) => patch({ alwaysShowFolderCount: v })}
        />
        <ToggleRow
          label="Show file types"
          hint="Show extensions such as .md beside note names in the explorer."
          value={settings.showFileTypes}
          defaultValue={FALLBACK_SETTINGS.showFileTypes}
          onChange={(v) => patch({ showFileTypes: v })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Performance</h3>
        <ToggleRow
          label="Lighter graph"
          hint="Fewer labels and a faster-settling simulation. Worth turning on past a few thousand notes."
          value={settings.graphPerformanceMode}
          defaultValue={FALLBACK_SETTINGS.graphPerformanceMode}
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

/* ------------------------------------------------------ settings profiles */

function SettingsProfilesTab(): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const theme = useSettings((s) => s.theme)
  const applyProfile = useSettings((s) => s.applyProfile)
  const [profiles, setProfiles] = useState<SettingsPreset[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = (): void => {
    void window.lumina.settings.profiles().then(setProfiles)
  }
  useEffect(reload, [])

  const save = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const profile = await window.lumina.settings.saveProfile(name.trim(), settings, theme)
      setProfiles((current) => [...current, profile])
      setName('')
      toast(`Saved “${profile.name}”`)
    } finally {
      setBusy(false)
    }
  }

  const importProfile = async (): Promise<void> => {
    try {
      const profile = await window.lumina.settings.importProfile()
      if (!profile) return
      setProfiles((current) => [...current, profile])
      toast(`Imported “${profile.name}”`)
    } catch {
      toast('That file is not valid Lumina settings JSON', 'error')
    }
  }

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Settings profiles</h3>
        <p className="field-hint">
          Save the complete settings and theme as named snapshots. Applying one changes the current
          vault; the other profiles stay available to switch back at any time.
        </p>
        <div className="settings-profile-create">
          <input
            type="text"
            value={name}
            placeholder="Profile name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void save() }}
          />
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void save()}>
            Save current
          </button>
          <button className="btn" onClick={() => void importProfile()}>
            <Icon name="download" size={14} /> Import JSON
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Available profiles</h3>
        {profiles.length ? profiles.map((profile) => (
          <div className="settings-profile-row" key={profile.id}>
            <div className="settings-profile-copy">
              <span className="field-label">{profile.name}</span>
              <span className="field-hint">Saved {new Date(profile.createdAt).toLocaleDateString()}</span>
            </div>
            <button className="btn btn-small" onClick={() => {
              applyProfile(profile.settings, profile.theme)
              toast(`Applied “${profile.name}”`)
            }}>Apply</button>
            <button className="icon-btn" data-tooltip="Export JSON" onClick={() => {
              void window.lumina.settings.exportProfile(profile)
            }}><Icon name="download" size={14} /></button>
            <button className="icon-btn" data-tooltip="Delete profile" onClick={() => {
              void window.lumina.settings.deleteProfile(profile.id).then(() => {
                setProfiles((current) => current.filter((item) => item.id !== profile.id))
              })
            }}><Icon name="trash" size={14} /></button>
          </div>
        )) : <p className="field-hint">No saved profiles yet.</p>}
      </section>
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
            data-tooltip="Reset all hotkeys to defaults"
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
                    className="setting-default"
                    data-tooltip="Restore the default"
                    onClick={() => {
                      const next = { ...overrides }
                      delete next[command.id]
                      patch({ hotkeys: next })
                    }}
                  >
                    Default
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
  onChange,
  defaultValue
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
  defaultValue?: boolean
}): React.JSX.Element {
  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        {defaultValue !== undefined ? <DefaultButton label={label} onClick={() => onChange(defaultValue)} /> : null}
        <button
          className={`switch${value ? ' on' : ''}`}
          role="switch"
          aria-checked={value}
          aria-label={label}
          data-tooltip={`Toggle ${label.toLowerCase()}`}
          onClick={() => onChange(!value)}
        />
      </div>
    </div>
  )
}

function SegmentedRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  defaultValue
}: {
  label: string
  hint?: string
  value: string
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  defaultValue?: T
}): React.JSX.Element {
  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control segmented">
        {defaultValue !== undefined ? <DefaultButton label={label} onClick={() => onChange(defaultValue)} /> : null}
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`segmented-btn${value === opt.value ? ' on' : ''}`}
            data-tooltip={`Select ${opt.label}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TextRow({
  label,
  hint,
  value,
  placeholder,
  onChange,
  defaultValue
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  defaultValue?: string
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
        {defaultValue !== undefined ? <DefaultButton label={label} onClick={() => onChange(defaultValue)} /> : null}
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

/**
 * A bounded integer, committed on blur like `TextRow`.
 *
 * Committing per keystroke would restart the clip listener on every digit of a
 * port number, so the value only leaves here once the field is done with.
 */
/** A dropdown field row. Committed immediately — a select has no draft state. */
function SelectRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  defaultValue
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  defaultValue?: T
}): React.JSX.Element {
  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        {defaultValue !== undefined ? <DefaultButton label={label} onClick={() => onChange(defaultValue)} /> : null}
        <select
          className="mic-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function NumberRow({
  label,
  hint,
  value,
  min = 1024,
  max = 65535,
  onChange,
  defaultValue
}: {
  label: string
  hint?: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  defaultValue?: number
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    const parsed = Number(draft)
    // An out-of-range or non-numeric entry snaps back rather than being stored;
    // a port of 0 would bind to something arbitrary.
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) setDraft(String(value))
    else if (parsed !== value) onChange(parsed)
  }

  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        {defaultValue !== undefined ? <DefaultButton label={label} onClick={() => onChange(defaultValue)} /> : null}
        <input
          type="number"
          min={min}
          max={max}
          value={draft}
          style={{ width: 110 }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      </div>
    </div>
  )
}

function FontRow({
  label,
  hint,
  value,
  fonts,
  onChange,
  defaultValue = ''
}: {
  label: string
  hint?: string
  value: string
  fonts: string[]
  onChange: (value: string) => void
  defaultValue?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const listId = `font-${label.toLowerCase().replace(/\W+/g, '-')}`
  useEffect(() => setDraft(value), [value])

  return (
    <div className="field-row font-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        <DefaultButton label={label} onClick={() => onChange(defaultValue)} />
        <input
          type="text"
          list={listId}
          value={draft}
          placeholder="System default"
          spellCheck={false}
          style={{ width: 230, fontFamily: draft || undefined }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(draft.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onChange(draft.trim())
          }}
        />
        <datalist id={listId}>
          <option value="">System default</option>
          {fonts.map((font) => <option key={font} value={font} />)}
        </datalist>
      </div>
    </div>
  )
}

function DefaultButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      className="setting-default"
      data-tooltip="Restore default"
      aria-label={`Restore default ${label}`}
      onClick={onClick}
    >
      Default
    </button>
  )
}
