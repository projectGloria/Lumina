/**
 * Voice notes and dictation, from pressing record to the text in the note.
 *
 * Lives beside `actions.ts` and for the same reason: recording spans the
 * editor, settings and the UI store, and the command palette, the toolbar
 * button and a future hotkey all have to do it identically. The live
 * `RecorderHandle` stays module-level rather than in a store — it is a
 * microphone, not serialisable state — and only the phase the UI has to draw
 * is published through `uiStore`.
 */
import { encodeTarget } from '@shared/markdown-parse'
import { formatDuration } from '@shared/audio'
import { startRecording, toWhisperWav, type RecorderHandle } from './recorder'
import { startLiveDictation, type LiveDictation } from './liveDictation'
import { getActiveView } from '../editor/activeView'
import { useSettings } from '../store/settingsStore'
import { toast, useUi } from '../store/uiStore'

/** `note` saves the audio into the vault; `dictate` only wants the words. */
export type VoiceMode = 'note' | 'dictate'

let handle: RecorderHandle | null = null

/**
 * The live segmenter, when dictation is writing as the user speaks.
 *
 * Non-null means the text is already going into the note phrase by phrase, so
 * `stopVoice` must **not** transcribe the whole recording again — doing both
 * would write everything twice.
 */
let live: LiveDictation | null = null

/** The recorder's live input level, for the meter. 0 when not recording. */
export function inputLevel(): number {
  return handle?.level() ?? 0
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/**
 * The span of provisional text currently in the document.
 *
 * Live dictation writes a guess while you speak and replaces it when the
 * sentence settles, so it has to remember what it wrote. Null means there is
 * nothing provisional on screen — either nothing has been said yet, or the
 * last phrase has already settled.
 */
let interim: { from: number; to: number } | null = null

/**
 * Replace the provisional span with `text`, or insert at the caret if there is
 * none, and remember the new span when `provisional`.
 *
 * The span is re-read from the transaction rather than computed, so typing
 * elsewhere in the note while dictating does not shift it out from under us.
 * If the document no longer matches what we wrote — the user edited over it,
 * or undid it — the span is abandoned and the text is inserted fresh instead
 * of overwriting something the user meant to keep.
 */
function writeDictated(text: string, provisional: boolean): boolean {
  const view = getActiveView()
  if (!view) {
    interim = null
    return false
  }

  const span = interim
  const valid =
    span !== null && span.to <= view.state.doc.length && span.from <= span.to
  const from = valid ? (span as { from: number; to: number }).from : view.state.selection.main.from
  const to = valid ? (span as { from: number; to: number }).to : view.state.selection.main.to

  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true
  })

  interim = provisional ? { from, to: from + text.length } : null
  return true
}

/** Forget any provisional span, e.g. when a recording ends or is abandoned. */
function clearInterim(): void {
  interim = null
}

/**
 * Write text into the focused note at the caret.
 *
 * Returns false when no note is focused, which is a real case: dictation can
 * finish after the user has closed the tab it was started from, and silently
 * dropping a transcript would be the worst possible outcome here.
 */
function insertAtCaret(text: string): boolean {
  const view = getActiveView()
  if (!view) return false
  const sel = view.state.selection.main
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
    scrollIntoView: true
  })
  view.focus()
  return true
}

/**
 * Begin recording, or do nothing if a recording is already running.
 *
 * The microphone is opened before the UI switches to the recording state, so a
 * refused permission shows an error instead of a recorder that never ticks.
 */
export async function startVoice(mode: VoiceMode): Promise<void> {
  // `handle` is already null while a finished recording is being saved or
  // transcribed, so it alone does not say the feature is free — starting a
  // second recording there would overwrite the phase the bar is showing and
  // orphan the transcript that is still on its way.
  if (handle || useUi.getState().voice) return
  if (!getActiveView()) {
    toast('Open a note first', 'error')
    return
  }

  const ui = useUi.getState()
  ui.setVoice({ mode, phase: 'starting', startedAt: Date.now() })
  try {
    handle = await startRecording(useSettings.getState().settings.voice.deviceId)
  } catch (err) {
    ui.setVoice(null)
    toast((err as Error).message, 'error')
    return
  }
  ui.setVoice({ mode, phase: 'recording', startedAt: Date.now() })

  // Live preview is best-effort: if the resident model will not come up, the
  // recording carries on and the transcript arrives in one piece at the end.
  const settings = useSettings.getState().settings.voice
  if (mode === 'dictate' && settings.liveDictation) {
    const failure = await window.lumina.voice.liveStart()
    if (failure) {
      toast(`${failure} — the transcript will arrive when you finish`, 'info')
    } else if (handle) {
      clearInterim()
      live = startLiveDictation(handle.stream, {
        // Provisional: rewritten in place each time the guess improves.
        onInterim: (text) => writeDictated(text, true),
        // Settled: the space ends the span, so the next phrase starts after it.
        // A space rather than a newline, because consecutive phrases are one
        // paragraph and joining them back up is harder than splitting them.
        onFinal: (text) => {
          if (!writeDictated(`${text} `, false)) toast(text)
        },
        onPending: (pending) => useUi.getState().setVoicePending(pending)
      })
    }
  }
}

/** Throw the recording away and release the microphone. */
export function cancelVoice(): void {
  live?.cancel()
  live = null
  clearInterim()
  handle?.cancel()
  handle = null
  void window.lumina.voice.liveStop()
  useUi.getState().setVoice(null)
}

/**
 * Finish recording and put the result in the note.
 *
 * The audio is saved before it is transcribed, and deliberately so: whisper can
 * take a while and can fail, and losing a recording because the model was
 * missing would be unforgivable. In `dictate` mode there is no file to lose, so
 * a failed transcription costs only the words.
 */
export async function stopVoice(): Promise<void> {
  const current = handle
  if (!current) return
  handle = null

  const ui = useUi.getState()
  const mode = ui.voice?.mode ?? 'note'
  ui.setVoice({ mode, phase: 'saving', startedAt: Date.now() })

  // Flush the phrase still being spoken before the stream is torn down, so the
  // last sentence is not the one that goes missing.
  const wasLive = live
  if (wasLive) {
    ui.setVoice({ mode, phase: 'transcribing', startedAt: Date.now() })
    live = null
    await wasLive.finish()
    clearInterim()
  }

  let recording: Awaited<ReturnType<RecorderHandle['stop']>>
  try {
    recording = await current.stop()
  } catch (err) {
    ui.setVoice(null)
    toast(`Recording failed: ${(err as Error).message}`, 'error')
    return
  }

  if (!recording) {
    ui.setVoice(null)
    toast('Nothing was recorded', 'error')
    return
  }

  const voice = useSettings.getState().settings.voice
  const keepAudio = mode === 'note' && voice.keepAudio
  let savedPath: string | null = null

  if (keepAudio) {
    const name = `Voice ${stamp()}.${recording.ext}`
    const res = await window.lumina.files.saveAttachment(
      voice.folder || 'attachments',
      name,
      await recording.blob.arrayBuffer()
    )
    if (!res.ok || !res.data) {
      ui.setVoice(null)
      toast(res.error ?? 'Could not save the recording', 'error')
      return
    }
    savedPath = res.data

    // In the note before transcription starts, so the recording is safe on disk
    // and linked even if whisper is missing or fails.
    if (!insertAtCaret(`![${formatDuration(recording.seconds)}](${encodeTarget(savedPath)})\n`)) {
      toast(`Recording saved to ${savedPath}`)
    }
  }

  // Live mode has already written everything as it was spoken.
  if (wasLive) {
    ui.setVoice(null)
    return
  }

  const wantsText = voice.transcribe || mode === 'dictate'
  if (!wantsText) {
    ui.setVoice(null)
    return
  }

  ui.setVoice({ mode, phase: 'transcribing', startedAt: Date.now() })
  try {
    const status = await window.lumina.voice.status()
    if (!status.available) {
      // Not an error in `note` mode — the audio is already saved and linked, so
      // this is a missing optional extra, not a lost recording.
      toast(status.reason ?? 'No speech model installed', savedPath ? 'info' : 'error')
      return
    }

    const wav = await toWhisperWav(recording.blob)
    const result = await window.lumina.voice.transcribe(wav, voice.language)
    if (!result.ok) {
      toast(result.error ?? 'Transcription failed', 'error')
      return
    }
    if (!result.text) {
      toast('No speech was recognised')
      return
    }

    // Under the player when there is one, so the note reads as audio then text.
    if (!insertAtCaret(savedPath ? `${result.text}\n\n` : `${result.text} `)) {
      await navigator.clipboard.writeText(result.text)
      toast('No note was focused — the transcript is on the clipboard')
    }
  } catch (err) {
    toast(`Transcription failed: ${(err as Error).message}`, 'error')
  } finally {
    ui.setVoice(null)
  }
}

/** Start if idle, finish if recording — what a single toolbar button needs. */
export function toggleVoice(mode: VoiceMode): void {
  if (handle) void stopVoice()
  else void startVoice(mode)
}

/** True only while the microphone is open, not while whisper is still working. */
export function isRecording(): boolean {
  return handle !== null
}
