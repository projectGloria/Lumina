/**
 * Dictation that writes while you are still talking.
 *
 * Two decisions carry this file.
 *
 * **Raw PCM, not blobs.** The microphone is read through
 * `MediaStreamTrackProcessor`, which yields decoded audio frames, so the audio
 * captured so far can be turned into a WAV at any instant. A `MediaRecorder`
 * only hands back a container blob when it stops, which is fine for one
 * transcription per phrase and useless for refining a sentence as it is being
 * spoken — there is nothing to decode until the speaker has already finished.
 *
 * **Interim then final.** While someone speaks, the phrase-so-far is
 * re-transcribed every few hundred milliseconds and shown as provisional text
 * that keeps changing. When they pause, the complete phrase is transcribed once
 * more and that result replaces it. Whisper is far more accurate given a whole
 * utterance than a truncated one, so the early guesses are deliberately
 * disposable — the interim exists to prove the app is listening, and the final
 * is the text that stays.
 */
import { encodeWav, resampleTo16k } from '@shared/audio'
import { levelFromSamples, smoothLevel } from './recorder'

/** Level above which we consider someone to be speaking. */
const SPEAKING = 0.34

/** Quiet for this long ends a phrase. Long enough to survive a breath. */
const SILENCE_MS = 650

/** Don't start a phrase on a cough or a chair creak. */
const MIN_PHRASE_MS = 300

/**
 * How often the phrase-so-far is re-transcribed while speaking.
 *
 * Slower than the ~200ms a GPU build takes, so requests do not queue up behind
 * each other; a CPU build simply produces fewer interim updates rather than
 * falling behind, because a request is skipped whenever one is already running.
 */
const INTERIM_MS = 450

/** Never send an interim shorter than this: whisper invents words from noise. */
const MIN_INTERIM_MS = 700

/**
 * A phrase is cut here even if the speaker has not paused.
 *
 * Kept under the ~10 seconds that `--audio-ctx 512` covers, because a CPU-only
 * install still uses that window (`main/whisperServer.ts`). A GPU build runs
 * with full context and would not need the cap, but the limit has to hold for
 * the slower of the two.
 */
const MAX_PHRASE_MS = 8000

export interface LiveDictation {
  finish: () => Promise<void>
  cancel: () => void
}

export interface LiveOptions {
  /** Provisional text for the phrase in progress. Replaces the previous interim. */
  onInterim: (text: string) => void
  /** The settled text for a finished phrase. Replaces any interim before it. */
  onFinal: (text: string) => void
  onSpeaking?: (speaking: boolean) => void
  /** True while a final phrase is still being transcribed. */
  onPending?: (pending: number) => void
}

export function startLiveDictation(stream: MediaStream, options: LiveOptions): LiveDictation {
  const track = stream.getAudioTracks()[0]

  /** Captured audio, at the device's own rate, since the phrase began. */
  let buffer = new Float32Array(0)
  let sampleRate = 48000

  let smoothed = 0
  let speaking = false
  let phraseStart = 0
  let lastLoud = 0
  let stopped = false

  /** Guards against piling requests up when transcription is slower than INTERIM_MS. */
  let interimBusy = false
  let lastInterimAt = 0
  let pending = 0

  /** Finals are chained so two phrases cannot land out of order. */
  let queue: Promise<void> = Promise.resolve()

  const setPending = (delta: number): void => {
    pending += delta
    options.onPending?.(pending)
  }

  const append = (chunk: Float32Array): void => {
    const next = new Float32Array(buffer.length + chunk.length)
    next.set(buffer)
    next.set(chunk, buffer.length)
    buffer = next
  }

  /** Everything captured since the phrase started, as a 16 kHz mono WAV. */
  const phraseWav = (): ArrayBuffer | null => {
    const from = Math.min(phraseStart, buffer.length)
    const slice = buffer.subarray(from)
    if (!slice.length) return null
    return encodeWav(resampleTo16k(slice, sampleRate), 16000)
  }

  const phraseMs = (): number => ((buffer.length - phraseStart) / sampleRate) * 1000

  const sendInterim = (): void => {
    if (interimBusy || stopped) return
    const wav = phraseWav()
    if (!wav) return

    interimBusy = true
    void window.lumina.voice
      .transcribeLive(wav)
      .then((text) => {
        // Discard a result that arrived after the phrase it described ended —
        // it would overwrite the final with a worse, earlier guess.
        if (text && speaking && !stopped) options.onInterim(text)
      })
      .catch(() => {})
      .finally(() => {
        interimBusy = false
      })
  }

  /**
   * Close the phrase and transcribe it properly.
   *
   * `keep` is false when cancelling, where the audio is dropped rather than
   * spending a transcription on text nobody will see.
   */
  const endPhrase = (keep: boolean): void => {
    const long = phraseMs() >= MIN_PHRASE_MS
    const wav = long && keep ? phraseWav() : null

    // Drop the consumed audio; a long dictation would otherwise grow a buffer
    // holding every sample of it.
    buffer = new Float32Array(0)
    phraseStart = 0

    if (!wav) return
    setPending(1)
    queue = queue
      .then(async () => {
        try {
          const text = await window.lumina.voice.transcribeLive(wav)
          if (text) options.onFinal(text)
        } finally {
          setPending(-1)
        }
      })
      .catch(() => setPending(-1))
  }

  /* The microphone feed. Each frame updates the level, which drives both the
     speech detector and the interim clock. */
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()

  const pump = async (): Promise<void> => {
    while (!stopped) {
      const { done, value } = await reader.read()
      if (done || !value) break

      const frames = value.numberOfFrames
      sampleRate = value.sampleRate
      const chunk = new Float32Array(frames)
      try {
        // Plane 0 is the first channel: mono in, and the left channel of a
        // stereo device, which is what a headset microphone puts its signal on.
        value.copyTo(chunk, { planeIndex: 0, format: 'f32-planar' })
      } finally {
        value.close()
      }
      if (stopped) break

      append(chunk)
      smoothed = smoothLevel(smoothed, levelFromSamples(chunk))
      const now = performance.now()

      if (smoothed >= SPEAKING) {
        lastLoud = now
        if (!speaking) {
          speaking = true
          // Keep a little of what came before: the detector always trips a
          // fraction late, and without this every phrase loses its first
          // consonant.
          phraseStart = Math.max(0, buffer.length - Math.floor(sampleRate * 0.25))
          lastInterimAt = now
          options.onSpeaking?.(true)
        }
        if (phraseMs() >= MAX_PHRASE_MS) {
          endPhrase(true)
          phraseStart = 0
          lastInterimAt = now
        } else if (now - lastInterimAt >= INTERIM_MS && phraseMs() >= MIN_INTERIM_MS) {
          lastInterimAt = now
          sendInterim()
        }
        continue
      }

      if (speaking && now - lastLoud >= SILENCE_MS) {
        speaking = false
        options.onSpeaking?.(false)
        endPhrase(true)
      }
    }
  }

  void pump().catch(() => {})

  const release = (): void => {
    stopped = true
    void reader.cancel().catch(() => {})
  }

  return {
    finish: async () => {
      if (stopped) return
      // The phrase in progress is transcribed before the feed is torn down —
      // it is usually the last thing the user said.
      if (speaking) {
        speaking = false
        endPhrase(true)
      }
      release()
      await queue
    },
    cancel: () => {
      speaking = false
      release()
    }
  }
}
