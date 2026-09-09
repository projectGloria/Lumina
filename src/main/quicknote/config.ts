import fs from 'node:fs/promises'
import path from 'node:path'
export async function readDestination(file: string): Promise<{ root: string; folder: string }> {
  const config = JSON.parse(await fs.readFile(file, 'utf8'))
  const profile = Array.isArray(config.profiles)
    ? config.profiles.find((p: { id: string }) => p.id === config.activeProfileId) : undefined
  if (profile?.passwordHash) throw new Error('Choose an unprotected destination profile in Vault first.')
  const root = profile ? profile.vaultPath : config.lastVault
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Choose a vault in Lumina first.')
  if (!(await fs.stat(root)).isDirectory()) throw new Error('The vault folder is unavailable.')
  return { root, folder: typeof config.quickNote?.folder === 'string' && config.quickNote.folder.trim()
    ? config.quickNote.folder : 'Inbox' }
}
