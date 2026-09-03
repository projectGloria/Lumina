import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeMissing, locateVoiceTools } from '../src/main/transcribe'

/**
 * Finding the speech model is the part that fails on a real machine, and it
 * fails quietly: the wrong answer is a dictation command that does nothing.
 * These run against a real directory tree because every question here — does
 * this file exist, which of these models is bigger — is about what is on disk.
 */
describe('locateVoiceTools', () => {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  let tmp: string
  let folder: string

  const write = async (file: string, size = 1): Promise<string> => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, Buffer.alloc(size))
    return file
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-voice-'))
    folder = path.join(tmp, 'whisper')
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('reports both as missing on a machine with nothing installed', async () => {
    const tools = await locateVoiceTools(tmp)
    expect(tools.binary).toBeNull()
    expect(tools.model).toBeNull()
    expect(describeMissing(tools)).toContain(folder)
  })

  it('finds a binary and a model sitting in the conventional folder', async () => {
    const bin = await write(path.join(folder, exe))
    const model = await write(path.join(folder, 'ggml-base.bin'), 10)

    const tools = await locateVoiceTools(tmp)
    expect(tools.binary).toBe(bin)
    expect(tools.model).toBe(model)
    expect(describeMissing(tools)).toBeNull()
  })

  it('looks in models/ as well, the layout whisper.cpp itself uses', async () => {
    await write(path.join(folder, exe))
    const model = await write(path.join(folder, 'models', 'ggml-small.bin'), 10)
    expect((await locateVoiceTools(tmp)).model).toBe(model)
  })

  it('prefers the larger model, which is the one downloaded most recently', async () => {
    await write(path.join(folder, exe))
    await write(path.join(folder, 'ggml-tiny.bin'), 10)
    const bigger = await write(path.join(folder, 'ggml-small.bin'), 500)
    expect((await locateVoiceTools(tmp)).model).toBe(bigger)
  })

  it('honours an explicit override over anything in the folder', async () => {
    await write(path.join(folder, exe))
    await write(path.join(folder, 'ggml-base.bin'), 10)
    const ownBin = await write(path.join(tmp, 'elsewhere', 'my-whisper'))
    const ownModel = await write(path.join(tmp, 'elsewhere', 'my.bin'), 5)

    const tools = await locateVoiceTools(tmp, { binaryPath: ownBin, modelPath: ownModel })
    expect(tools.binary).toBe(ownBin)
    expect(tools.model).toBe(ownModel)
  })

  it('reports an override that does not exist rather than falling back', async () => {
    // Silently using a different model than the one configured would be worse
    // than saying nothing was found.
    await write(path.join(folder, exe))
    await write(path.join(folder, 'ggml-base.bin'), 10)

    const tools = await locateVoiceTools(tmp, { modelPath: path.join(tmp, 'missing.bin') })
    expect(tools.binary).not.toBeNull()
    expect(tools.model).toBeNull()
    expect(describeMissing(tools)).toContain('No .bin speech model')
  })

  it('does not mistake a directory for the executable', async () => {
    await fs.mkdir(path.join(folder, exe), { recursive: true })
    expect((await locateVoiceTools(tmp)).binary).toBeNull()
  })

  it('names only the piece that is actually missing', async () => {
    await write(path.join(folder, exe))
    expect(describeMissing(await locateVoiceTools(tmp))).toContain('No .bin speech model')

    await fs.rm(path.join(folder, exe))
    await write(path.join(folder, 'ggml-base.bin'), 10)
    expect(describeMissing(await locateVoiceTools(tmp))).toContain('No whisper executable')
  })
})

describe('GPU build detection', () => {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  let tmp: string

  const write = async (file: string, size = 1): Promise<string> => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, Buffer.alloc(size))
    return file
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-gpu-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('prefers a CUDA build over the CPU one and says so', async () => {
    await write(path.join(tmp, 'whisper', exe))
    await write(path.join(tmp, 'whisper', 'ggml-small.bin'), 10)
    const gpuExe = await write(path.join(tmp, 'whisper-cuda', exe))
    await write(path.join(tmp, 'whisper-cuda', 'ggml-cuda.dll'))

    const tools = await locateVoiceTools(tmp)
    expect(tools.binary).toBe(gpuExe)
    expect(tools.gpu).toBe(true)
  })

  it('shares the model already downloaded beside the CPU build', async () => {
    // The GPU archive ships no model, so it has to find the existing one
    // rather than reporting nothing installed.
    await write(path.join(tmp, 'whisper-cuda', exe))
    await write(path.join(tmp, 'whisper-cuda', 'ggml-cuda.dll'))
    const model = await write(path.join(tmp, 'whisper', 'ggml-small.bin'), 10)

    const tools = await locateVoiceTools(tmp)
    expect(tools.model).toBe(model)
    expect(describeMissing(tools)).toBeNull()
  })

  it('falls back to the CPU build when no CUDA one is installed', async () => {
    const cpu = await write(path.join(tmp, 'whisper', exe))
    await write(path.join(tmp, 'whisper', 'ggml-small.bin'), 10)

    const tools = await locateVoiceTools(tmp)
    expect(tools.binary).toBe(cpu)
    expect(tools.gpu).toBe(false)
  })

  it('does not claim GPU for a build with no CUDA library beside it', async () => {
    // A folder named whisper-cuda proves nothing; the backend DLL does.
    await write(path.join(tmp, 'whisper-cuda', exe))
    await write(path.join(tmp, 'whisper-cuda', 'ggml-small.bin'), 10)
    expect((await locateVoiceTools(tmp)).gpu).toBe(false)
  })
})
