import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  importSpeechPack,
  installSpeechPack,
  listSpeechPacks,
  removeSpeechPack
} from '../src/main/speechPacks'
import { locateVoiceTools } from '../src/main/transcribe'

/**
 * Installing a speech pack is a file copy, so these run against real
 * directories. The thing worth pinning down is not the copy itself but where
 * things land: a pack has to end up exactly where `locateVoiceTools` looks, or
 * the install appears to succeed and dictation still reports nothing found.
 */
describe('speech packs', () => {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  let tmp: string
  let userData: string
  let resources: string

  const write = async (file: string, size = 1): Promise<string> => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, Buffer.alloc(size))
    return file
  }

  /** A build with every pack in it, as `fetch-speech-packs.ps1` produces. */
  const bundleAll = async (): Promise<void> => {
    await write(path.join(resources, 'speech', 'engine-cpu', exe), 100)
    await write(path.join(resources, 'speech', 'engine-cpu', 'whisper-server.exe'), 100)
    await write(path.join(resources, 'speech', 'engine-cuda', exe), 100)
    await write(path.join(resources, 'speech', 'engine-cuda', 'ggml-cuda.dll'), 500)
    await write(path.join(resources, 'speech', 'model-base', 'ggml-base.bin'), 300)
    await write(path.join(resources, 'speech', 'model-small', 'ggml-small.bin'), 900)
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-packs-'))
    userData = path.join(tmp, 'userData')
    resources = path.join(tmp, 'resources')
    await fs.mkdir(userData, { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('reports nothing bundled for a build without packs', async () => {
    const packs = await listSpeechPacks(userData, resources)
    expect(packs).toHaveLength(4)
    expect(packs.every((p) => !p.bundled && !p.installed)).toBe(true)
    // The sizes drive what the panel shows, so an absent pack must read as 0
    // rather than as an unknown.
    expect(packs.every((p) => p.size === 0)).toBe(true)
  })

  it('sees what the build carries, with real sizes', async () => {
    await bundleAll()
    const packs = await listSpeechPacks(userData, resources)
    expect(packs.every((p) => p.bundled)).toBe(true)
    expect(packs.find((p) => p.id === 'model-small')?.size).toBe(900)
    expect(packs.find((p) => p.id === 'engine-cuda')?.size).toBe(600)
  })

  it('refuses to install a pack this build does not carry', async () => {
    expect(await installSpeechPack('engine-cuda', userData, resources)).toMatch(/not included/i)
  })

  it('refuses an unknown id rather than writing somewhere unexpected', async () => {
    await bundleAll()
    expect(await installSpeechPack('../escape', userData, resources)).toBe('Unknown speech pack')
    expect(await removeSpeechPack('../escape', userData)).toBe('Unknown speech pack')
  })

  it('installs where locateVoiceTools actually looks', async () => {
    // The whole point: after installing an engine and a model, the lookup that
    // dictation uses has to find both.
    await bundleAll()
    expect(await installSpeechPack('engine-cpu', userData, resources)).toBeNull()
    expect(await installSpeechPack('model-small', userData, resources)).toBeNull()

    const tools = await locateVoiceTools(userData)
    expect(tools.binary).toBe(path.join(userData, 'whisper', exe))
    expect(tools.model).toBe(path.join(userData, 'whisper', 'models', 'ggml-small.bin'))
    expect(tools.gpu).toBe(false)
  })

  it('installs the GPU engine where the GPU lookup finds it', async () => {
    await bundleAll()
    await installSpeechPack('engine-cuda', userData, resources)
    await installSpeechPack('model-base', userData, resources)

    const tools = await locateVoiceTools(userData)
    expect(tools.binary).toBe(path.join(userData, 'whisper-cuda', exe))
    expect(tools.gpu).toBe(true)
    // The GPU pack ships no model, so it has to use the one installed beside
    // the CPU engine's folder.
    expect(tools.model).toBe(path.join(userData, 'whisper', 'models', 'ggml-base.bin'))
  })

  it('reports a pack as installed once its files are there', async () => {
    await bundleAll()
    await installSpeechPack('model-base', userData, resources)

    const packs = await listSpeechPacks(userData, resources)
    expect(packs.find((p) => p.id === 'model-base')?.installed).toBe(true)
    expect(packs.find((p) => p.id === 'model-small')?.installed).toBe(false)
  })

  it('reports progress that adds up to the total', async () => {
    await bundleAll()
    const seen: number[] = []
    let total = 0
    await installSpeechPack('engine-cuda', userData, resources, (p) => {
      seen.push(p.copied)
      total = p.total
    })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBe(total)
    // Monotonic, or a percentage would jump backwards on screen.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
  })

  it('removing a model leaves the engine and the other model alone', async () => {
    await bundleAll()
    await installSpeechPack('engine-cpu', userData, resources)
    await installSpeechPack('model-base', userData, resources)
    await installSpeechPack('model-small', userData, resources)

    expect(await removeSpeechPack('model-base', userData)).toBeNull()

    const packs = await listSpeechPacks(userData, resources)
    expect(packs.find((p) => p.id === 'model-base')?.installed).toBe(false)
    expect(packs.find((p) => p.id === 'model-small')?.installed).toBe(true)
    expect(packs.find((p) => p.id === 'engine-cpu')?.installed).toBe(true)
  })

  it('removing the CPU engine does not take the models with it', async () => {
    // Models live in `whisper/models`, inside the engine's folder — so a naive
    // recursive delete of the engine would silently take them too.
    await bundleAll()
    await installSpeechPack('engine-cpu', userData, resources)
    await installSpeechPack('model-small', userData, resources)

    await removeSpeechPack('engine-cpu', userData)

    const packs = await listSpeechPacks(userData, resources)
    expect(packs.find((p) => p.id === 'engine-cpu')?.installed).toBe(false)
    expect(packs.find((p) => p.id === 'model-small')?.installed).toBe(true)
  })

  describe('importing from a folder', () => {
    it('recognises a CPU engine and puts it where it belongs', async () => {
      const from = path.join(tmp, 'usb')
      await write(path.join(from, exe), 10)

      expect(await importSpeechPack(from, userData)).toBeNull()
      expect((await locateVoiceTools(userData)).binary).toBe(path.join(userData, 'whisper', exe))
    })

    it('recognises a CUDA engine by its backend library, not its folder name', async () => {
      const from = path.join(tmp, 'some-random-name')
      await write(path.join(from, exe), 10)
      await write(path.join(from, 'ggml-cuda.dll'), 10)

      expect(await importSpeechPack(from, userData)).toBeNull()
      const tools = await locateVoiceTools(userData)
      expect(tools.binary).toBe(path.join(userData, 'whisper-cuda', exe))
      expect(tools.gpu).toBe(true)
    })

    it('recognises a bare model file', async () => {
      const from = path.join(tmp, 'models-usb')
      await write(path.join(from, 'ggml-small.bin'), 50)

      expect(await importSpeechPack(from, userData)).toBeNull()
      expect((await locateVoiceTools(userData)).model).toBe(
        path.join(userData, 'whisper', 'models', 'ggml-small.bin')
      )
    })

    it('refuses a folder holding neither', async () => {
      const from = path.join(tmp, 'holiday-photos')
      await write(path.join(from, 'beach.jpg'), 10)
      expect(await importSpeechPack(from, userData)).toMatch(/No speech engine or \.bin model/)
    })

    it('refuses a folder that is not there', async () => {
      expect(await importSpeechPack(path.join(tmp, 'nope'), userData)).toMatch(/could not be read/i)
    })
  })
})
