/**
 * Speech to text, entirely on this machine.
 *
 * Lumina makes no network request unless the user turns link previews on, and
 * dictation is not going to be the thing that breaks that promise — so this
 * shells out to a local `whisper.cpp` build rather than calling a service. That
 * costs a binary and a model file the app does not ship, which is why so much
 * of this file is about finding them and explaining their absence clearly.
 *
 * No `electron` import: the lookup and the parsing are the interesting parts
 * and they stay testable, the same reason `openFile.ts` avoids it. The one
 * thing only Electron knows — where `userData` lives — is passed in.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseWhisperOutput } from '@shared/audio'

/** Names whisper.cpp has shipped its CLI under, newest first. */
export const BINARY_NAMES =
  process.platform === 'win32'
    ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cli', 'whisper', 'main']

export interface VoiceTools {
  /** Absolute path to the whisper executable, or null when it was not found. */
  binary: string | null
  /**
   * True when the chosen build ships the CUDA backend.
   *
   * Worth knowing because it changes how the live server is tuned: on a GPU the
   * reduced audio context that makes CPU transcription bearable saves nothing
   * (measured 269ms vs 246ms) and costs accuracy, so it is only used off GPU.
   */
  gpu: boolean
  /** Absolute path to a `.bin` GGML model, or null when none is present. */
  model: string | null
  /** Where a user should put them, shown in settings. */
  folder: string
}

export interface TranscribeResult {
  ok: boolean
  text?: string
  error?: string
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

/**
 * The first `.bin` in the folder, preferring the larger model when several are
 * present — someone who downloaded `small` after `base` meant to use `small`.
 */
async function findModel(folder: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.readdir(folder)
  } catch {
    return null
  }
  const models = names.filter((n) => n.toLowerCase().endsWith('.bin'))
  if (!models.length) return null

  const sized = await Promise.all(
    models.map(async (name) => {
      const full = path.join(folder, name)
      try {
        return { full, size: (await fs.stat(full)).size }
      } catch {
        return { full, size: 0 }
      }
    })
  )
  sized.sort((a, b) => b.size - a.size)
  return sized[0].full
}

/**
 * Where the pieces are, given the user's overrides and the conventional folder.
 *
 * An explicit setting always wins and is never second-guessed: if someone
 * points at a binary that does not exist, saying so beats silently falling back
 * to a different one and transcribing with a model they did not choose.
 */
export async function locateVoiceTools(
  userDataDir: string,
  overrides: { binaryPath?: string; modelPath?: string } = {}
): Promise<VoiceTools> {
  const folder = path.join(userDataDir, 'whisper')
  // A CUDA build is looked for first and used automatically when present: it is
  // the same whisper against the same model, several times faster, so there is
  // nothing for the user to choose. The CPU build stays where it is and keeps
  // working if the GPU one is removed.
  const gpuFolder = path.join(userDataDir, 'whisper-cuda')
  const searchIn = [gpuFolder, folder]

  let binary: string | null = null
  if (overrides.binaryPath) {
    binary = (await isFile(overrides.binaryPath)) ? overrides.binaryPath : null
  } else {
    outer: for (const dir of searchIn) {
      for (const name of BINARY_NAMES) {
        const candidate = path.join(dir, name)
        if (await isFile(candidate)) {
          binary = candidate
          break outer
        }
      }
    }
  }

  // The model is looked for across both folders, so a GPU build dropped beside
  // an existing install shares the model already downloaded rather than
  // needing its own copy.
  let model: string | null = null
  if (overrides.modelPath) {
    model = (await isFile(overrides.modelPath)) ? overrides.modelPath : null
  } else {
    for (const dir of searchIn) {
      model = (await findModel(path.join(dir, 'models'))) ?? (await findModel(dir))
      if (model) break
    }
  }

  const gpu = binary ? await isFile(path.join(path.dirname(binary), 'ggml-cuda.dll')) : false
  return { binary, model, folder, gpu }
}

/** A sentence the settings panel and the toast can both show as-is. */
export function describeMissing(tools: VoiceTools): string | null {
  if (!tools.binary && !tools.model) {
    return `No speech model installed. Put a whisper.cpp build and a .bin model in ${tools.folder}.`
  }
  if (!tools.binary) return `No whisper executable in ${tools.folder}.`
  if (!tools.model) return `No .bin speech model in ${tools.folder}.`
  return null
}

/**
 * Transcribe 16 kHz mono WAV bytes.
 *
 * The audio is written to the OS temp folder rather than the vault: a vault is
 * the user's own folder of notes and a scratch file for a transcription that
 * may be discarded does not belong in it. It is removed on every path out,
 * including failure.
 */
export async function transcribe(
  wav: ArrayBuffer,
  tools: VoiceTools,
  options: { language?: string; threads?: number; timeoutMs?: number } = {}
): Promise<TranscribeResult> {
  const missing = describeMissing(tools)
  if (missing || !tools.binary || !tools.model) return { ok: false, error: missing ?? 'Speech model unavailable' }
  if (!wav.byteLength) return { ok: false, error: 'Nothing was recorded' }

  const file = path.join(os.tmpdir(), `lumina-voice-${randomUUID()}.wav`)
  try {
    await fs.writeFile(file, Buffer.from(wav))

    const args = [
      '--model', tools.model,
      '--file', file,
      '--no-timestamps',
      '--no-prints',
      '--threads', String(options.threads ?? Math.max(1, Math.min(8, os.cpus().length - 1)))
    ]
    // `auto` is whisper's own detection, and passing it explicitly is not the
    // same as omitting the flag on every build, so leave it off instead.
    if (options.language && options.language !== 'auto') args.push('--language', options.language)

    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(
        tools.binary as string,
        args,
        {
          // A long recording produces a lot of stdout; the default 1MB cap
          // would truncate the transcript mid-sentence.
          maxBuffer: 32 * 1024 * 1024,
          timeout: options.timeoutMs ?? 10 * 60_000,
          windowsHide: true
        },
        (err, stdout, stderr) => {
          if (err) {
            // whisper writes its progress to stderr, so stderr alone is not a
            // failure — only a non-zero exit is, and its last line is the part
            // worth showing.
            const detail = String(stderr || err.message).trim().split(/\r?\n/).pop()
            reject(new Error(detail || 'Transcription failed'))
            return
          }
          resolve({ stdout })
        }
      )
    })

    return { ok: true, text: parseWhisperOutput(stdout) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
  }
}
