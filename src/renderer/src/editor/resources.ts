/** Turning link targets into URLs the renderer is allowed to load. */
import { dirname, joinPath, normalizePath } from '@shared/markdown-parse'
import { useSettings } from '../store/settingsStore'

/**
 * Vault files are served over a custom `lumina://` scheme registered in the
 * main process. The renderer runs from http in dev and file in production, so
 * neither could read the vault directly, and this keeps the CSP tight.
 */
export function vaultUrl(rel: string): string {
  const encoded = normalizePath(rel).split('/').map(encodeURIComponent).join('/')
  return `lumina://vault/${encoded}`
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i

export function isImageTarget(target: string): boolean {
  return IMAGE_RE.test(target)
}

/**
 * Candidate locations for an attachment, most likely first.
 *
 * Only markdown is indexed, so an image target cannot be resolved the way a
 * note link is. The image widget walks these in order and keeps the first that
 * loads, which covers the two conventions people actually use: a shared
 * attachments folder, or the file sitting next to the note.
 */
export function attachmentCandidates(target: string, fromPath: string): string[] {
  // `target` is a real vault path here, not a markdown destination — callers
  // that read one out of `](...)` decode it first, because `vaultUrl` encodes
  // again on the way out and decoding twice would 404 a name containing a `%`.
  const t = normalizePath(target)
  if (t.includes('/')) return [t]

  const folder = useSettings.getState().settings.attachmentFolder
  const noteDir = dirname(fromPath)
  const out = [
    folder ? joinPath(folder, t) : t,
    noteDir ? joinPath(noteDir, t) : t,
    t
  ]
  return [...new Set(out)]
}
