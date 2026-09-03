/**
 * Read aloud: select some text, listen to it.
 *
 * The counterpart to `voice.ts` and deliberately much smaller. Dictation needs
 * a whisper build and a model on disk; speaking needs neither, because the
 * renderer already has the operating system's own synthesizer behind
 * `speechSynthesis`. Nothing is downloaded, nothing is sent anywhere, and it
 * works on a machine that has never been online — the same promise the rest of
 * the voice features make, kept for free here.
 *
 * Lives beside `voice.ts` for the same reason: reading spans the editor, read
 * mode, settings and the UI store, and the palette, the hotkey and the
 * right-click menu all have to do it identically. The utterance queue stays
 * module-level — a synthesizer is not serialisable state — and only the phase
 * the player bar draws goes through `uiStore`.
 */
import { speechChunks, speechText } from '@shared/speech'
import { getActiveView } from '../editor/activeView'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { toast, useUi } from '../store/uiStore'
import { titleOf } from '../store/vaultStore'
import { activePath } from '../store/workspaceStore'

let chunks: string[] = []
let index = 0

/**
 * Which run of the queue is current.
 *
 * `speechSynthesis.cancel()` still delivers `end` (or `error`) for the
 * utterance it interrupted, so every callback checks the generation it was
 * created under. Without this, stopping one reading starts the next chunk of
 * it a moment later.
 */
let generation = 0

let keepAlive: ReturnType<typeof setInterval> | null = null

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * The voices this machine has.
 *
 * Chromium populates the list asynchronously, so the first call after a cold
 * start can legitimately return nothing — `onVoicesChanged` is how the settings
 * panel waits for it.
 */
export function listVoices(): SpeechSynthesisVoice[] {
  if (!speechAvailable()) return []
  return window.speechSynthesis.getVoices()
}

export function onVoicesChanged(listener: () => void): () => void {
  if (!speechAvailable()) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', listener)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', listener)
}

/**
 * The text the user has selected, from wherever they selected it.
 *
 * The document's own selection comes first, because it is the only one that
 * knows about read mode, the search panel and a backlink excerpt. CodeMirror
 * is the fallback rather than the primary: it renders a real DOM selection
 * while focused, but it also *keeps* its state selection after focus moves to
 * the command palette, which is exactly when the document's has been collapsed.
 */
function selectionText(): string | null {
  const dom = window.getSelection()
  if (dom && !dom.isCollapsed) {
    const text = dom.toString().trim()
    if (text) return text
  }

  const view = getActiveView()
  if (view) {
    const range = view.state.selection.main
    if (!range.empty) {
      const text = view.state.sliceDoc(range.from, range.to).trim()
      if (text) return text
    }
  }

  return null
}

/** Speak `text`, replacing anything already being read. */
export function speak(text: string, label: string): void {
  if (!speechAvailable()) {
    toast('This machine has no speech voices installed', 'error')
    return
  }

  const prose = speechText(text)
  if (!prose) {
    toast('Nothing here to read aloud')
    return
  }

  chunks = speechChunks(prose)
  index = 0
  const run = ++generation
  useUi.getState().setSpeech({ label, phase: 'speaking', index: 0, total: chunks.length })

  // `cancel()` is asynchronous in Chromium, and speaking in the same tick as it
  // is how a reading ends up silent. One turn of the event loop is enough.
  window.speechSynthesis.cancel()
  setTimeout(() => play(run), 0)
  startKeepAlive()
}

function play(run: number): void {
  if (run !== generation) return

  if (index >= chunks.length) {
    finish(run)
    return
  }

  const { readAloud } = useSettings.getState().settings.voice
  const utterance = new SpeechSynthesisUtterance(chunks[index])
  // An empty (or stale) voiceURI leaves the choice to the platform rather than
  // failing — a voice the user uninstalled must not silence the feature.
  const voice = readAloud.voice
    ? listVoices().find((v) => v.voiceURI === readAloud.voice)
    : undefined
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  utterance.rate = readAloud.rate
  utterance.pitch = readAloud.pitch
  utterance.volume = readAloud.volume

  utterance.onend = () => {
    if (run !== generation) return
    index += 1
    useUi.getState().setSpeechProgress(index)
    play(run)
  }

  utterance.onerror = (event) => {
    if (run !== generation) return
    // `interrupted` and `canceled` are what a stop or a skip looks like from
    // in here; they are not failures and the user has already seen the result.
    if (event.error === 'interrupted' || event.error === 'canceled') return
    toast(`Could not read this aloud: ${event.error}`, 'error')
    finish(run)
  }

  window.speechSynthesis.speak(utterance)
}

function finish(run: number): void {
  if (run !== generation) return
  generation += 1
  chunks = []
  index = 0
  stopKeepAlive()
  useUi.getState().setSpeech(null)
}

/**
 * Read the selection, or the whole note when there is none.
 *
 * Falling back to the note rather than refusing is what makes one key both
 * "read this bit" and "read this to me" — with nothing selected there is only
 * one thing the user can mean.
 */
export function readAloudSelection(): void {
  const selected = selectionText()
  if (selected) {
    speak(selected, 'Selection')
    return
  }

  const path = activePath()
  const content = path ? useEditor.getState().buffers[path]?.content : undefined
  if (!path || content === undefined) {
    toast('Select some text, or open a note to read')
    return
  }

  speak(content, titleOf(path))
}

/** Start reading, or stop the reading already running. */
export function toggleReadAloud(): void {
  if (isReading()) {
    stopReading()
    return
  }
  readAloudSelection()
}

export function isReading(): boolean {
  return useUi.getState().speech !== null
}

export function stopReading(): void {
  if (!speechAvailable()) return
  generation += 1
  chunks = []
  index = 0
  stopKeepAlive()
  window.speechSynthesis.cancel()
  useUi.getState().setSpeech(null)
}

export function togglePauseReading(): void {
  const state = useUi.getState()
  const speech = state.speech
  if (!speech || !speechAvailable()) return

  if (speech.phase === 'paused') {
    window.speechSynthesis.resume()
    state.setSpeechProgress(speech.index, 'speaking')
    startKeepAlive()
  } else {
    // The keep-alive below resumes a stalled synthesizer, so it has to stand
    // down while the pause is the user's own.
    stopKeepAlive()
    window.speechSynthesis.pause()
    state.setSpeechProgress(speech.index, 'paused')
  }
}

/** Jump `delta` utterances. Past the end is a stop; before the start is a replay. */
export function skipReading(delta: number): void {
  const speech = useUi.getState().speech
  if (!speech || !speechAvailable()) return

  const target = index + delta
  if (target >= chunks.length) {
    stopReading()
    return
  }

  const run = ++generation
  index = Math.max(0, target)
  useUi.getState().setSpeechProgress(index, 'speaking')
  window.speechSynthesis.cancel()
  setTimeout(() => play(run), 0)
  startKeepAlive()
}

/** A sample sentence in the current voice, for the settings panel. */
export function previewVoice(): void {
  speak('This is how Lumina will read your notes aloud.', 'Preview')
}

/**
 * Nudge a synthesizer that has stopped speaking without telling anyone.
 *
 * Chromium's speech synthesis stalls on some platform voices partway through a
 * queue, and a `resume()` restarts it. It is a no-op while speech is actually
 * running, which is why it can be fired blindly — but only while the reading is
 * meant to be running, or it would undo the user's own pause.
 */
function startKeepAlive(): void {
  stopKeepAlive()
  keepAlive = setInterval(() => {
    if (useUi.getState().speech?.phase !== 'speaking') return
    window.speechSynthesis.resume()
  }, 8000)
}

function stopKeepAlive(): void {
  if (keepAlive === null) return
  clearInterval(keepAlive)
  keepAlive = null
}
