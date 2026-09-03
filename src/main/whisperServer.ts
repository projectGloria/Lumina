/**
 * A whisper process that stays alive, which is what makes live dictation live.
 *
 * The measurements that produced this file, on a small model and a mid-range
 * CPU:
 *
 * | approach                        | 1.1s clip | 3.8s clip |
 * |---------------------------------|-----------|-----------|
 * | `whisper-cli` per phrase        |   6.8 s   |   7.6 s   |
 * | server, model resident          |   4.9 s   |   5.1 s   |
 * | server + `--audio-ctx 512`      |   1.5 s   |   1.6 s   |
 *
 * Two things stand out. Almost all of the CLI's cost is loading the model, so
 * a process per phrase can never keep up — hence a server. And whisper pads
 * every input to a 30-second window, so the encoder costs the same for one
 * second of speech as for thirty; `--audio-ctx` shrinks that window and is
 * where the remaining 3x comes from.
 *
 * `--audio-ctx 512` is not free accuracy-wise, but 512 frames is about ten
 * seconds of audio, so a phrase shorter than that loses nothing at all. The
 * renderer caps phrases below that on purpose (`MAX_PHRASE_MS`), which is what
 * makes this a fair trade rather than a quiet downgrade.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import os from 'node:os'
import type { VoiceTools } from './transcribe'

/**
 * How much audio the encoder attends to. 512 frames ≈ 10s, which comfortably
 * covers a spoken phrase and costs a third of the full window.
 */
const AUDIO_CTX = 512

/** Model loading dominates startup; this is generous enough for a large one. */
const READY_TIMEOUT_MS = 90_000

/**
 * Shut the server down after this long without a phrase.
 *
 * It holds the whole model resident — around 600 MB for `small` — which is a
 * lot to keep for a feature the user may have finished with. Restarting costs
 * the load time again, but only after five idle minutes.
 */
const IDLE_MS = 5 * 60_000

interface Running {
  process: ChildProcess
  port: number
  model: string
  ready: Promise<string | null>
}

let running: Running | null = null
let idleTimer: NodeJS.Timeout | null = null

/** Ask the OS for a free port by briefly binding one. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}

/** Poll until the server answers, so the first phrase is not sent into a void. */
async function waitForReady(port: number, child: ChildProcess): Promise<string | null> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return `Speech server exited (code ${child.exitCode})`
    try {
      // Any answer at all means the HTTP layer is up and the model is loaded;
      // whisper-server does not listen until it has finished loading.
      await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
      return null
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  return 'Speech server did not start in time'
}

function clearIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

function armIdle(): void {
  clearIdle()
  idleTimer = setTimeout(() => void stopWhisperServer(), IDLE_MS)
  // Node should not stay alive purely to hold this timer.
  idleTimer.unref?.()
}

/**
 * Ensure a server is up for `tools.model`, starting one if needed.
 *
 * Returns an error string rather than throwing, because every caller wants to
 * show it rather than handle it — and a failure here should cost live preview,
 * never the recording.
 */
export async function ensureWhisperServer(tools: VoiceTools): Promise<string | null> {
  if (!tools.binary || !tools.model) return 'No speech model installed'

  // A different model than the one running means the setting changed under us.
  if (running && running.model !== tools.model) await stopWhisperServer()
  if (running) {
    armIdle()
    return running.ready
  }

  const serverBinary = tools.binary.replace(/whisper-cli(\.exe)?$/i, 'whisper-server$1')
  const port = await freePort()

  const child = spawn(
    serverBinary,
    [
      '--model', tools.model,
      '--host', '127.0.0.1',
      '--port', String(port),
      // Only off GPU. On the RTX card this was measured at 246ms with the
      // reduced window and 269ms without — 23ms is not worth the accuracy.
      ...(tools.gpu ? [] : ['--audio-ctx', String(AUDIO_CTX)]),
      '--no-timestamps',
      '--threads', String(Math.max(1, Math.min(8, (os.cpus().length || 4) - 1)))
    ],
    { windowsHide: true, stdio: 'ignore' }
  )

  const state: Running = { process: child, port, model: tools.model, ready: Promise.resolve(null) }
  state.ready = waitForReady(port, child).then((error) => {
    if (error) {
      // A server that never came up must not be left as `running`, or every
      // later phrase would be posted to a dead port.
      if (running === state) running = null
      child.kill()
    }
    return error
  })
  running = state

  child.once('exit', () => {
    if (running === state) running = null
  })

  armIdle()
  return state.ready
}

/**
 * Transcribe one phrase against the resident model.
 *
 * Returns null on any failure: live preview is a convenience, and a dropped
 * phrase should never surface as an error mid-sentence.
 */
export async function transcribeLive(wav: ArrayBuffer, language?: string): Promise<string | null> {
  if (!running) return null
  armIdle()

  try {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'phrase.wav')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    if (language && language !== 'auto') form.append('language', language)

    const response = await fetch(`http://127.0.0.1:${running.port}/inference`, {
      method: 'POST',
      body: form
    })
    if (!response.ok) return null

    const data = (await response.json()) as { text?: string }
    return (data.text ?? '').trim() || null
  } catch {
    return null
  }
}

export async function stopWhisperServer(): Promise<void> {
  clearIdle()
  const state = running
  running = null
  if (!state) return
  state.process.kill()
}

export function whisperServerRunning(): boolean {
  return running !== null
}
