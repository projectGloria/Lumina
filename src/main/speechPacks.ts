/**
 * Speech engines and models that ship inside the installer.
 *
 * Lumina makes no network request for these. Everything is carried in the
 * build under `resources/speech`, and installing a pack copies it out of there
 * into `userData` — no download, no unpacking service, nothing to be offline
 * for. A machine with no network at all can install Lumina and dictate.
 *
 * Copying rather than using the files where they sit is deliberate. The
 * install directory is replaced wholesale by an update and removed by an
 * uninstall, so a pack used in place would vanish under the user twice over;
 * a pack in `userData` outlives both, which is the same reason vaults and
 * settings live there. It costs the disk of one copy, which is why the
 * installer offers the choice rather than taking it.
 *
 * `importPack` covers the other half of "offline": a build that shipped
 * without a pack can still take one from a folder or a USB stick.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SpeechInstallProgress, SpeechPack, SpeechPackKind } from '@shared/types'
import { BINARY_NAMES } from './transcribe'

export type { SpeechInstallProgress, SpeechPack }

/**
 * The catalogue.
 *
 * Ids are stable and are what the renderer sends back, so renaming one is a
 * breaking change for a stored preference; the folder names double as the
 * layout `locateVoiceTools` searches.
 */
const CATALOGUE: Omit<SpeechPack, 'size' | 'bundled' | 'installed'>[] = [
  {
    id: 'engine-cpu',
    kind: 'engine',
    name: 'Speech engine (CPU)',
    description: 'Works on any machine. Slower — around a second and a half per phrase.',
    folder: 'whisper'
  },
  {
    id: 'engine-cuda',
    kind: 'engine',
    name: 'Speech engine (NVIDIA GPU)',
    description: 'Several times faster and more accurate, on an NVIDIA card. Large.',
    folder: 'whisper-cuda',
    requiresGpu: true
  },
  {
    id: 'model-base',
    kind: 'model',
    name: 'Model — base',
    description: 'Small and quick. Good for English, weaker on accents and other languages.',
    folder: 'whisper/models'
  },
  {
    id: 'model-small',
    kind: 'model',
    name: 'Model — small',
    description: 'Noticeably better, including Turkish. The right default on a GPU.',
    folder: 'whisper/models'
  }
]

/** Files a model pack owns, since models share one folder. */
const MODEL_FILES: Record<string, string> = {
  'model-base': 'ggml-base.bin',
  'model-small': 'ggml-small.bin'
}

/** Where a pack's payload sits inside the build. */
function bundledDir(resourcesPath: string, pack: { id: string }): string {
  return path.join(resourcesPath, 'speech', pack.id)
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

/** Total bytes of a directory tree, or 0 when it is not there. */
async function treeSize(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await treeSize(full)
    else {
      try {
        total += (await fs.stat(full)).size
      } catch {
        /* raced with a delete; it contributes nothing */
      }
    }
  }
  return total
}

/**
 * Whether a pack is already usable from `userData`.
 *
 * An engine counts as installed once its executable is there — a half-copied
 * folder should read as missing rather than as broken.
 */
async function isInstalled(
  userDataDir: string,
  pack: { id: string; kind: SpeechPackKind; folder: string }
): Promise<boolean> {
  const dir = path.join(userDataDir, pack.folder)
  if (pack.kind === 'model') return exists(path.join(dir, MODEL_FILES[pack.id]))
  for (const name of BINARY_NAMES) {
    if (await exists(path.join(dir, name))) return true
  }
  return false
}

export async function listSpeechPacks(
  userDataDir: string,
  resourcesPath: string
): Promise<SpeechPack[]> {
  return Promise.all(
    CATALOGUE.map(async (pack) => {
      const source = bundledDir(resourcesPath, pack)
      const size = await treeSize(source)
      return {
        ...pack,
        size,
        bundled: size > 0,
        installed: await isInstalled(userDataDir, pack)
      }
    })
  )
}

/**
 * Copy a pack into `userData`.
 *
 * Files are copied one at a time so progress can be reported: a GPU engine is
 * well over a gigabyte, and a settings panel that sits still for that long
 * looks broken however fast the copy actually is.
 */
async function copyTree(
  from: string,
  to: string,
  onBytes: (bytes: number) => void
): Promise<void> {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await copyTree(source, target, onBytes)
      continue
    }
    await fs.copyFile(source, target)
    onBytes((await fs.stat(target)).size)
  }
}

/**
 * Install one pack from the build, reporting progress as it goes.
 *
 * Resolves with an error string rather than throwing — the caller is a
 * settings panel, and every failure here is something to show rather than
 * something to handle.
 */
export async function installSpeechPack(
  id: string,
  userDataDir: string,
  resourcesPath: string,
  onProgress?: (progress: SpeechInstallProgress) => void
): Promise<string | null> {
  const pack = CATALOGUE.find((entry) => entry.id === id)
  if (!pack) return 'Unknown speech pack'

  const source = bundledDir(resourcesPath, pack)
  const total = await treeSize(source)
  if (!total) return 'That pack is not included in this build'

  const target = path.join(userDataDir, pack.folder)
  let copied = 0
  try {
    await copyTree(source, target, (bytes) => {
      copied += bytes
      onProgress?.({ id, copied, total })
    })
    return null
  } catch (err) {
    return `Could not install: ${(err as Error).message}`
  }
}

/**
 * Take a pack from a folder the user picked, for a build that shipped without
 * one — a copy on a USB stick, or one extracted by hand.
 *
 * The folder is identified by what is in it rather than by its name, because
 * nothing guarantees the user kept ours.
 */
export async function importSpeechPack(
  sourceDir: string,
  userDataDir: string,
  onProgress?: (progress: SpeechInstallProgress) => void
): Promise<string | null> {
  const entries = await fs.readdir(sourceDir).catch(() => null)
  if (!entries) return 'That folder could not be read'

  const hasEngine = entries.some((name) => BINARY_NAMES.includes(name))
  const models = entries.filter((name) => name.toLowerCase().endsWith('.bin'))
  if (!hasEngine && !models.length) {
    return 'No speech engine or .bin model in that folder'
  }

  // A CUDA build is told apart by its backend library, the same test
  // `locateVoiceTools` uses, so an imported one lands where the GPU lookup
  // will find it.
  const cuda = entries.includes('ggml-cuda.dll')
  const folder = hasEngine ? (cuda ? 'whisper-cuda' : 'whisper') : 'whisper/models'
  const target = path.join(userDataDir, folder)

  const total = await treeSize(sourceDir)
  let copied = 0
  try {
    await copyTree(sourceDir, target, (bytes) => {
      copied += bytes
      onProgress?.({ id: folder, copied, total })
    })
    return null
  } catch (err) {
    return `Could not import: ${(err as Error).message}`
  }
}

/** Delete an installed pack, for reclaiming the disk it takes. */
export async function removeSpeechPack(id: string, userDataDir: string): Promise<string | null> {
  const pack = CATALOGUE.find((entry) => entry.id === id)
  if (!pack) return 'Unknown speech pack'

  try {
    if (pack.kind === 'model') {
      await fs.rm(path.join(userDataDir, pack.folder, MODEL_FILES[id]), { force: true })
      return null
    }

    // An engine is removed file by file rather than as a folder, because the
    // CPU engine's folder *contains* `models/` — a recursive delete would take
    // a model the user installed separately with it, which is gigabytes of
    // someone else's download destroyed by a button labelled "remove engine".
    // Only the executables and libraries go; anything `.bin` is a model and
    // stays wherever it is, as do subdirectories.
    const dir = path.join(userDataDir, pack.folder)
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || entry.name.toLowerCase().endsWith('.bin')) continue
      await fs.rm(path.join(dir, entry.name), { force: true })
    }
    // Take the folder too, but only if nothing of the user's is left in it.
    await fs.rmdir(dir).catch(() => {})
    return null
  } catch (err) {
    return `Could not remove: ${(err as Error).message}`
  }
}
