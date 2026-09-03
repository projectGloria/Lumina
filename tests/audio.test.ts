import { describe, expect, it } from 'vitest'
import {
  encodeWav,
  formatDuration,
  isAudioTarget,
  parseWhisperOutput,
  resampleTo16k,
  WHISPER_LANGUAGES,
  WHISPER_SAMPLE_RATE,
  whisperLanguageName
} from '@shared/audio'

describe('isAudioTarget', () => {
  it('recognises the formats a recording or an imported clip arrives in', () => {
    for (const name of ['a.webm', 'a.m4a', 'a.MP3', 'voice/note.ogg', 'x.wav', 'y.opus']) {
      expect(isAudioTarget(name)).toBe(true)
    }
  })

  it('leaves images and notes to the widgets that own them', () => {
    for (const name of ['a.png', 'a.md', 'webm', 'a.webmx', 'a.mp4']) {
      expect(isAudioTarget(name)).toBe(false)
    }
  })
})

describe('encodeWav', () => {
  const read = (buf: ArrayBuffer, at: number, len: number): string =>
    String.fromCharCode(...new Uint8Array(buf, at, len))

  it('writes a header whisper will accept: mono, 16-bit, 16 kHz', () => {
    const wav = encodeWav(new Float32Array(8))
    const view = new DataView(wav)
    expect(read(wav, 0, 4)).toBe('RIFF')
    expect(read(wav, 8, 4)).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(WHISPER_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
  })

  it('sizes the file and its two length fields to the sample count', () => {
    const wav = encodeWav(new Float32Array(100))
    const view = new DataView(wav)
    expect(wav.byteLength).toBe(44 + 200)
    expect(view.getUint32(4, true)).toBe(36 + 200) // RIFF chunk size
    expect(view.getUint32(40, true)).toBe(200) // data chunk size
  })

  it('clamps rather than wrapping, so a loud passage does not invert', () => {
    const view = new DataView(encodeWav(new Float32Array([1.8, -1.8])))
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })

  it('round-trips a sample close enough for speech', () => {
    const view = new DataView(encodeWav(new Float32Array([0.5])))
    expect(view.getInt16(44, true) / 0x7fff).toBeCloseTo(0.5, 4)
  })
})

describe('parseWhisperOutput', () => {
  it('keeps the text and drops the timestamps', () => {
    const out = [
      '[00:00:00.000 --> 00:00:02.400]   Hello there.',
      '[00:00:02.400 --> 00:00:05.000]   This is a note.'
    ].join('\n')
    expect(parseWhisperOutput(out)).toBe('Hello there. This is a note.')
  })

  it('handles real whisper-cli output, captured verbatim', () => {
    // Copied byte for byte from `whisper-cli.exe --no-timestamps --no-prints`
    // (whisper.cpp b4938, ggml-small). Leading newline and space included,
    // because those are exactly what broke the first version of this parser.
    const real =
      '\n The quick brown fox jumps over the lazy dog. Lumina is a local first note-taking application.'
    expect(parseWhisperOutput(real)).toBe(
      'The quick brown fox jumps over the lazy dog. Lumina is a local first note-taking application.'
    )
  })

  it('keeps a plain untimestamped transcript — what --no-timestamps produces', () => {
    // The format `transcribe.ts` actually asks for. An earlier version of this
    // parser treated a bare line as banner noise and returned nothing, so every
    // dictation reported "no speech recognised" while whisper was working fine.
    expect(parseWhisperOutput(' The quick brown fox jumps over the lazy dog.\n')).toBe(
      'The quick brown fox jumps over the lazy dog.'
    )
  })

  it('joins several untimestamped lines into one transcript', () => {
    expect(parseWhisperOutput(' First sentence.\n Second sentence.\n')).toBe(
      'First sentence. Second sentence.'
    )
  })

  it('drops whisper log lines if a build sends them to stdout', () => {
    const out = [
      'whisper_init_from_file_with_params_no_state: loading model',
      'system_info: n_threads = 4',
      'load_backend: loaded CPU backend from ggml-cpu.dll',
      'Real text.'
    ].join('\n')
    expect(parseWhisperOutput(out)).toBe('Real text.')
  })

  it('does not mistake spoken prose for a log line', () => {
    // The log filter matches lowercase snake_case prefixes only, because a
    // transcript really can begin this way and losing speech is the worse bug.
    expect(parseWhisperOutput('Note: this matters.')).toBe('Note: this matters.')
    expect(parseWhisperOutput('Warning: mind the step.')).toBe('Warning: mind the step.')
    expect(parseWhisperOutput('So: we begin.')).toBe('So: we begin.')
  })

  it('drops the markers that stand in for silence', () => {
    const out = [
      '[00:00:00.000 --> 00:00:03.000]   [BLANK_AUDIO]',
      '[00:00:03.000 --> 00:00:04.000]   Words.',
      '[00:00:04.000 --> 00:00:06.000]   (inaudible)'
    ].join('\n')
    expect(parseWhisperOutput(out)).toBe('Words.')
  })

  it('returns empty for silence rather than failing', () => {
    expect(parseWhisperOutput('[00:00:00.000 --> 00:00:03.000]   [BLANK_AUDIO]')).toBe('')
    expect(parseWhisperOutput('')).toBe('')
  })
})

describe('formatDuration', () => {
  it('pads the seconds so the display does not jitter', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(64)).toBe('1:04')
    expect(formatDuration(600)).toBe('10:00')
  })

  it('floors a partial second and refuses to go negative', () => {
    expect(formatDuration(1.99)).toBe('0:01')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('WHISPER_LANGUAGES', () => {
  it('covers the languages whisper actually supports', () => {
    // 99 from the original multilingual set, plus Cantonese, which whisper
    // added with large-v3 — so 100 is right for a current whisper.cpp.
    expect(WHISPER_LANGUAGES.length).toBe(100)
    const codes = WHISPER_LANGUAGES.map((l) => l.code)
    // A spread of the list, including the three-letter codes that are easy to
    // typo and the ones this vault is most likely to need.
    for (const code of ['en', 'tr', 'de', 'zh', 'haw', 'yue', 'jw', 'nn']) {
      expect(codes).toContain(code)
    }
  })

  it('has no duplicate codes or names', () => {
    expect(new Set(WHISPER_LANGUAGES.map((l) => l.code)).size).toBe(WHISPER_LANGUAGES.length)
    expect(new Set(WHISPER_LANGUAGES.map((l) => l.name)).size).toBe(WHISPER_LANGUAGES.length)
  })

  it('is sorted by name, which is the order the dropdown renders', () => {
    const names = WHISPER_LANGUAGES.map((l) => l.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('uses codes whisper would accept: short, lowercase, no padding', () => {
    for (const { code } of WHISPER_LANGUAGES) expect(code).toMatch(/^[a-z]{2,3}$/)
  })
})

describe('whisperLanguageName', () => {
  it('names a known code', () => {
    expect(whisperLanguageName('tr')).toBe('Turkish')
    expect(whisperLanguageName('en')).toBe('English')
  })

  it('treats auto and empty as automatic detection', () => {
    expect(whisperLanguageName('auto')).toBe('Detect automatically')
    expect(whisperLanguageName('')).toBe('Detect automatically')
  })

  it('falls back to the code itself, so a hand-edited setting still shows', () => {
    expect(whisperLanguageName('xx')).toBe('xx')
  })
})

describe('resampleTo16k', () => {
  it('returns the same data when it is already 16 kHz', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(resampleTo16k(input, 16000)).toBe(input)
  })

  it('scales the length by the rate ratio', () => {
    expect(resampleTo16k(new Float32Array(48000), 48000).length).toBe(16000)
    expect(resampleTo16k(new Float32Array(44100), 44100).length).toBe(16000)
    expect(resampleTo16k(new Float32Array(960), 48000).length).toBe(320)
  })

  it('preserves a constant signal exactly', () => {
    const flat = new Float32Array(4800).fill(0.5)
    const out = resampleTo16k(flat, 48000)
    for (const sample of out) expect(sample).toBeCloseTo(0.5, 6)
  })

  it('keeps a ramp monotonic, so the waveform is not scrambled', () => {
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800)
    const out = resampleTo16k(ramp, 48000)
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
  })

  it('never reads past the end of the input', () => {
    // The last output sample interpolates against index+1, which must clamp.
    const out = resampleTo16k(new Float32Array([1, 1, 1]), 48000)
    for (const sample of out) expect(Number.isFinite(sample)).toBe(true)
  })

  it('handles an empty buffer', () => {
    expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0)
  })
})
