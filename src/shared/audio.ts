/**
 * Audio the vault stores, and the one format a speech model will read.
 *
 * Process-neutral on purpose: the renderer captures and encodes, the main
 * process hands the result to whisper, and both need to agree on what counts
 * as an audio note and what the WAV header says.
 */

const AUDIO_RE = /\.(m4a|mp3|wav|ogg|oga|opus|webm|flac|aac)$/i

/** True for a link target the editor should draw as a player rather than a link. */
export function isAudioTarget(target: string): boolean {
  return AUDIO_RE.test(target)
}

/**
 * The sample rate whisper.cpp expects. It resamples nothing itself: hand it
 * anything else and it either refuses the file or transcribes noise.
 */
export const WHISPER_SAMPLE_RATE = 16000

/**
 * Wrap mono float samples in a 16-bit PCM WAV.
 *
 * Written by hand rather than pulled from a library because it is 40 lines and
 * the alternative — shelling out to ffmpeg — would mean shipping a second
 * binary purely to change a container.
 */
export function encodeWav(samples: Float32Array, sampleRate = WHISPER_SAMPLE_RATE): ArrayBuffer {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * bytesPerSample, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // PCM, uncompressed
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 8 * bytesPerSample, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * bytesPerSample, true)

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a sample above 1 would wrap to a large negative
    // 16-bit value and turn a loud passage into a burst of noise.
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * bytesPerSample, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

/** `1:04`, for the recorder's elapsed display and an audio note's caption. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * The transcript whisper.cpp prints, cleaned up into something worth pasting.
 *
 * `whisper-cli` writes one `[00:00:00.000 --> 00:00:02.000]   text` line per
 * segment on stdout, interleaved with progress and model chatter on stderr. We
 * only ever want the text, joined into paragraphs — and an empty result has to
 * be distinguishable from a failure, so this returns '' rather than throwing.
 */
export function parseWhisperOutput(stdout: string): string {
  const lines: string[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const timed = line.match(/^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*(.*)$/)
    const text = (timed ? timed[1] : line).trim()
    if (!text) continue
    // Silence is emitted as a bracketed marker rather than an empty segment.
    if (/^[[(](?:BLANK_AUDIO|INAUDIBLE|MUSIC|SILENCE|NOISE)[\])]$/i.test(text)) continue
    if (!timed && WHISPER_LOG.test(text)) continue
    lines.push(text)
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * A whisper progress line rather than speech.
 *
 * These normally go to stderr — `transcribe.ts` passes `--no-prints`, and the
 * loader chatter does not reach stdout — so this is only a backstop for a build
 * that is noisier. It matches whisper's own `lower_snake_case:` prefixes and
 * nothing else on purpose: a transcript really can begin "Note: ...", and
 * dropping a spoken line would be far worse than keeping a log one.
 *
 * An untimestamped line is otherwise kept, because `--no-timestamps` is exactly
 * what we ask for — treating a bare line as noise threw away every transcript.
 */
const WHISPER_LOG = /^[a-z][a-z0-9_]*(?:\.[a-z]+)?:\s/

/* ------------------------------------------------------------- languages */

export interface WhisperLanguage {
  /** The code whisper expects after `--language`. */
  code: string
  /** English name, which is what the settings dropdown lists. */
  name: string
}

/**
 * Every language whisper's multilingual models are trained on.
 *
 * Kept beside the rest of the whisper knowledge rather than in the settings
 * component, because it is a property of the model and not of the UI — and
 * because `transcribe.ts` passes these codes through verbatim, so the two have
 * to agree. Sorted by name, since that is the order the dropdown wants; `auto`
 * is not in the list, it is the absence of a choice (`transcribe.ts` omits the
 * flag entirely, which is not the same as passing `auto` on every build).
 *
 * The **codes** are the contract; the names are only labels and deliberately
 * do not all match whisper's own strings — it calls `my` "myanmar" and `nn`
 * "nynorsk", where "Burmese" and "Norwegian Nynorsk" read better in a menu.
 * Changing a code is a real change and needs checking against the binary,
 * which rejects an unknown one with `error: unknown language '…'`.
 */
export const WHISPER_LANGUAGES: WhisperLanguage[] = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Albanian' },
  { code: 'am', name: 'Amharic' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'as', name: 'Assamese' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'ba', name: 'Bashkir' },
  { code: 'eu', name: 'Basque' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'br', name: 'Breton' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'my', name: 'Burmese' },
  { code: 'yue', name: 'Cantonese' },
  { code: 'ca', name: 'Catalan' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'fo', name: 'Faroese' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gl', name: 'Galician' },
  { code: 'ka', name: 'Georgian' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'ht', name: 'Haitian Creole' },
  { code: 'ha', name: 'Hausa' },
  { code: 'haw', name: 'Hawaiian' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'jw', name: 'Javanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'km', name: 'Khmer' },
  { code: 'ko', name: 'Korean' },
  { code: 'lo', name: 'Lao' },
  { code: 'la', name: 'Latin' },
  { code: 'lv', name: 'Latvian' },
  { code: 'ln', name: 'Lingala' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'ms', name: 'Malay' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mt', name: 'Maltese' },
  { code: 'mi', name: 'Maori' },
  { code: 'mr', name: 'Marathi' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'ne', name: 'Nepali' },
  { code: 'no', name: 'Norwegian' },
  { code: 'nn', name: 'Norwegian Nynorsk' },
  { code: 'oc', name: 'Occitan' },
  { code: 'ps', name: 'Pashto' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sa', name: 'Sanskrit' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sn', name: 'Shona' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'si', name: 'Sinhala' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'so', name: 'Somali' },
  { code: 'es', name: 'Spanish' },
  { code: 'su', name: 'Sundanese' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'tg', name: 'Tajik' },
  { code: 'ta', name: 'Tamil' },
  { code: 'tt', name: 'Tatar' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'bo', name: 'Tibetan' },
  { code: 'tr', name: 'Turkish' },
  { code: 'tk', name: 'Turkmen' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
  { code: 'yi', name: 'Yiddish' },
  { code: 'yo', name: 'Yoruba' }
]

/** The name for a stored code, or the code itself if it is not one we know. */
export function whisperLanguageName(code: string): string {
  if (!code || code === 'auto') return 'Detect automatically'
  return WHISPER_LANGUAGES.find((lang) => lang.code === code)?.name ?? code
}

/* ------------------------------------------------------------ resampling */

/**
 * Linear-interpolation resample to 16 kHz.
 *
 * Live dictation reads raw microphone frames, which arrive at whatever rate
 * the device runs (usually 48 kHz), and whisper accepts only 16 kHz. The
 * batch path can afford an `OfflineAudioContext` for this, but an interim
 * result is rebuilt several times a second while someone is still speaking —
 * so it needs to be synchronous and allocation-light rather than perfect.
 *
 * Linear interpolation is audibly worse than a windowed-sinc filter, but
 * speech recognition is unbothered by the aliasing it introduces, and the
 * alternative costs more than the transcription it feeds.
 */
export function resampleTo16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === WHISPER_SAMPLE_RATE || samples.length === 0) return samples

  const ratio = sampleRate / WHISPER_SAMPLE_RATE
  const length = Math.floor(samples.length / ratio)
  const out = new Float32Array(length)

  for (let i = 0; i < length; i++) {
    const at = i * ratio
    const low = Math.floor(at)
    const high = Math.min(low + 1, samples.length - 1)
    const fraction = at - low
    out[i] = samples[low] * (1 - fraction) + samples[high] * fraction
  }
  return out
}
