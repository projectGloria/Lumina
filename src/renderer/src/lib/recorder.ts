/**
 * Microphone capture, and the one conversion dictation needs.
 *
 * Two things come out of a recording and they want different formats: the file
 * saved into the vault should be small, so it stays the compressed blob the
 * browser produced, while whisper reads 16 kHz mono PCM and resamples nothing
 * itself. Rather than ship ffmpeg to convert between them, the recorded blob is
 * decoded and re-rendered through an `OfflineAudioContext`, which does the
 * downmix and the resample in a few lines and no dependency.
 */
import { encodeWav, WHISPER_SAMPLE_RATE } from '@shared/audio'

/** Preference order; the first the browser admits to supporting wins. */
const FORMATS = [
  { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
  { mimeType: 'audio/webm', ext: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mimeType: '', ext: 'webm' }
]

export interface Recording {
  blob: Blob
  /** File extension matching what was actually recorded. */
  ext: string
  seconds: number
}

export interface RecorderHandle {
  /**
   * The open microphone, so live dictation can segment the same capture.
   *
   * Shared rather than opened twice: two `getUserMedia` calls on one device
   * give two independently gain-controlled streams, and on some drivers the
   * second simply fails.
   */
  stream: MediaStream
  /** Finish and hand back the audio. Resolves with null if nothing was captured. */
  stop: () => Promise<Recording | null>
  /** Abandon the recording and release the microphone. */
  cancel: () => void
  /** Current input level, 0..1, for a meter. Safe to call at any time. */
  level: () => number
}

function pickFormat(): { mimeType: string; ext: string } {
  for (const format of FORMATS) {
    if (!format.mimeType || MediaRecorder.isTypeSupported(format.mimeType)) return format
  }
  return FORMATS[FORMATS.length - 1]
}

/** The processing every capture wants: speech, not a music recording. */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

/** Quietest input the meter shows at all. Below this is silence, visually. */
const FLOOR_DB = -60

/**
 * A meter reading, 0..1, from an analyser.
 *
 * Two things here are the difference between a meter that works and one that
 * looks broken, and the first version of this got both wrong:
 *
 * - **Float, not byte, data.** `getByteTimeDomainData` quantises to 8 bits, so
 *   ordinary speech sits within a couple of steps of the 128 midpoint and
 *   quiet speech is indistinguishable from silence.
 * - **Decibels, not amplitude.** Loudness is logarithmic. Mapping amplitude
 *   linearly puts normal speech (around -30 dBFS, or 0.03 linear) at 3% of the
 *   bar — technically moving, visibly dead. Over a -60..0 dB range the same
 *   speech reads about half scale, which is what a person expects to see.
 */
export function analyserLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer)
  return levelFromSamples(buffer)
}

/**
 * The same reading, straight from samples.
 *
 * Live dictation reads raw microphone frames rather than an analyser, and its
 * speech detection has to agree with what the meter shows — one threshold
 * against two different scales would be impossible to reason about.
 */
export function levelFromSamples(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) {
    const magnitude = Math.abs(sample)
    if (magnitude > peak) peak = magnitude
  }
  if (peak <= 0) return 0
  const db = 20 * Math.log10(peak)
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB))
}

/**
 * Smooth a meter so it rises immediately and falls gently.
 *
 * A raw peak reading flickers hard enough to be unreadable; holding the fall
 * is what makes a syllable visible rather than a flash.
 */
export function smoothLevel(previous: number, next: number): number {
  return next > previous ? next : previous * 0.82 + next * 0.18
}

export interface InputDevice {
  deviceId: string
  label: string
}

/**
 * The microphones this machine has, for the settings picker.
 *
 * `enumerateDevices` returns entries with **empty labels** until the page has
 * been granted microphone access at least once — the browser will not tell an
 * un-permitted page what hardware is attached. So a caller that gets blank
 * labels should ask for permission (start the meter) and enumerate again,
 * rather than showing a list of anonymous devices.
 */
export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput')
    // Chromium lists a synthetic "default"/"communications" entry alongside the
    // real device it points at; keeping both would show the same microphone
    // twice under two names.
    .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`
    }))
}

/** True once labels are readable, which is the same thing as having permission. */
export async function hasMicrophoneAccess(): Promise<boolean> {
  if (!navigator.mediaDevices?.enumerateDevices) return false
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.some((device) => device.kind === 'audioinput' && device.label !== '')
}

/**
 * Open a microphone, by id when one was chosen.
 *
 * A chosen device is requested with `exact`, so a microphone that has been
 * unplugged fails loudly and the caller can say so — falling back silently
 * would record the wrong input and the user would only find out on playback.
 * The failure is translated here because `NotAllowedError` tells nobody what
 * to do about it.
 */
async function openMicrophone(deviceId: string): Promise<MediaStream> {
  const audio: MediaTrackConstraints = deviceId
    ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } }
    : AUDIO_CONSTRAINTS
  try {
    return await navigator.mediaDevices.getUserMedia({ audio })
  } catch (err) {
    const name = (err as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Microphone access was refused')
    }
    if (name === 'OverconstrainedError' && deviceId) {
      throw new Error('The selected microphone is not available — pick another in Settings')
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No microphone was found')
    }
    throw new Error(`Could not open the microphone: ${(err as Error).message}`)
  }
}

export interface LevelMonitor {
  /** Current input level, 0..1. */
  level: () => number
  stop: () => void
}

/**
 * Open a microphone purely to watch its level.
 *
 * Deliberately separate from `startRecording`: the settings tester must never
 * be able to leave a `MediaRecorder` running, and nothing it opens is ever
 * written anywhere. Closing it releases the device so the OS indicator goes
 * out — which matters, because a meter that quietly holds the microphone open
 * is exactly what people are suspicious of.
 */
export async function startLevelMonitor(deviceId = ''): Promise<LevelMonitor> {
  const stream = await openMicrophone(deviceId)
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)

  let smoothed = 0
  let stopped = false
  return {
    level: () => {
      if (stopped) return 0
      smoothed = smoothLevel(smoothed, analyserLevel(analyser, samples))
      return smoothed
    },
    stop: () => {
      if (stopped) return
      stopped = true
      for (const track of stream.getTracks()) track.stop()
      void context.close().catch(() => {})
    }
  }
}

/**
 * Open the microphone and start recording.
 *
 * Rejects with a readable message rather than a `DOMException` name, because
 * the two cases a user actually hits — permission refused, no input device —
 * need different fixes and neither is obvious from `NotAllowedError`.
 */
export async function startRecording(deviceId = ''): Promise<RecorderHandle> {
  const stream = await openMicrophone(deviceId)
  const format = pickFormat()
  const recorder = new MediaRecorder(stream, format.mimeType ? { mimeType: format.mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }

  // A meter off the live stream. Its own context, closed with everything else.
  const meter = new AudioContext()
  const analyser = meter.createAnalyser()
  analyser.fftSize = 1024
  meter.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  let smoothed = 0

  const startedAt = performance.now()
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    for (const track of stream.getTracks()) track.stop()
    void meter.close().catch(() => {})
  }

  recorder.start()

  return {
    stream,

    level: () => {
      if (released) return 0
      smoothed = smoothLevel(smoothed, analyserLevel(analyser, samples))
      return smoothed
    },

    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },

    stop: () =>
      new Promise<Recording | null>((resolve) => {
        if (recorder.state === 'inactive') {
          release()
          resolve(null)
          return
        }
        const seconds = (performance.now() - startedAt) / 1000
        recorder.onstop = () => {
          release()
          const blob = new Blob(chunks, { type: format.mimeType || 'audio/webm' })
          resolve(blob.size ? { blob, ext: format.ext, seconds } : null)
        }
        recorder.stop()
      })
  }
}

/**
 * Recorded audio as the mono 16 kHz WAV whisper expects.
 *
 * `decodeAudioData` handles the opus-in-webm the recorder produces, and the
 * offline context does the downmix and resample on the way out — asking for
 * one channel at 16 kHz is the whole conversion.
 */
export async function toWhisperWav(blob: Blob): Promise<ArrayBuffer> {
  const decodeContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void decodeContext.close().catch(() => {})
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()

  const rendered = await offline.startRendering()
  return encodeWav(rendered.getChannelData(0))
}
