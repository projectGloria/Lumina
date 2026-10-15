/**
 * Turning a rendered note into a standalone file.
 *
 * The renderer produces the HTML — it has the parsed document and the live
 * theme — but that HTML still points at images by vault-relative path, which
 * means nothing once the file is somewhere else. Inlining them is what makes an
 * export a document rather than a bundle of broken references.
 *
 * Split out of `ipc.ts`, where it lived inside `registerIpc` and so was rebuilt
 * on every call and reachable from no test.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PREVIEW_DIR_NAME, safeVaultPath } from './paths'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
}

/** Largest single image worth inlining. Base64 inflates this by about a third. */
const MAX_IMAGE_EMBED_BYTES = 25 * 1024 * 1024

const IMG_RE = /<img\b([^>]*\bsrc=["'])([^"']+)(["'][^>]*)>/gi

/**
 * Where a vault-relative image reference might actually live.
 *
 * The note's own folder first, then the conventional attachment folder — the
 * same guessing the editor's image widget does, for the same reason: markdown
 * does not say which convention the author used.
 */
function candidatesFor(cleanPath: string, notePath?: string): string[] {
  return [
    cleanPath,
    notePath ? path.join(path.dirname(notePath), cleanPath) : null,
    path.join('attachments', cleanPath),
    // A link banner's cached thumbnail, so an exported note keeps its cards.
    path.join('.lumina', PREVIEW_DIR_NAME, cleanPath)
  ].filter((candidate): candidate is string => !!candidate)
}

/**
 * Replace every in-vault `<img src>` with a `data:` URI.
 *
 * Built in a single pass. The previous version called
 * `result.replace(item.full, replacement)` once per image, which re-scanned a
 * string that had just grown by the size of a base64 image — quadratic in the
 * number of images, on the main process, with no yielding. It also went through
 * `String.replace`'s substitution grammar, so an `alt` attribute containing
 * `$&` spliced the matched tag into its own replacement.
 *
 * Remote and `data:` sources are left exactly as they are.
 */
export async function embedLocalImages(
  html: string,
  vault: string | null,
  notePath?: string
): Promise<string> {
  if (!vault) return html

  const dataUriCache = new Map<string, string | null>()
  const out: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const imagePattern = new RegExp(IMG_RE.source, IMG_RE.flags)
  while ((match = imagePattern.exec(html)) !== null) {
    const [full, prefix, src, suffix] = match
    out.push(html.slice(lastIndex, match.index))
    lastIndex = match.index + full.length

    const rawSrc = src.trim()
    if (/^(?:data:|https?:|\/\/)/i.test(rawSrc)) {
      out.push(full)
      continue
    }

    let cleanPath = rawSrc
    if (cleanPath.startsWith('lumina://vault/')) {
      cleanPath = cleanPath.slice('lumina://vault/'.length)
    }
    try {
      cleanPath = decodeURIComponent(cleanPath.replace(/^\.?\//, ''))
    } catch {
      // A malformed escape is not a path we can resolve; leave the tag alone.
      out.push(full)
      continue
    }

    let dataUri = dataUriCache.get(cleanPath)
    if (dataUri === undefined) {
      dataUri = null
      for (const candidate of candidatesFor(cleanPath, notePath)) {
        const abs = await safeVaultPath(vault, candidate)
        if (!abs) continue
        try {
          const stat = await fs.stat(abs)
          if (!stat.isFile() || stat.size > MAX_IMAGE_EMBED_BYTES) continue
          const mime = MIME_TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream'
          const bytes = await fs.readFile(abs)
          dataUri = `data:${mime};base64,${bytes.toString('base64')}`
          break
        } catch {
          // Try the next candidate.
        }
      }
      dataUriCache.set(cleanPath, dataUri)
    }

    // `prefix` ends with the opening quote and starts with `<img`, which the
    // surrounding tag already supplies — hence `slice(4)`, as before.
    out.push(dataUri ? `<img${prefix}${dataUri}${suffix}>` : full)
  }

  out.push(html.slice(lastIndex))
  return out.join('')
}

/**
 * Park HTML in a temp file and hand back its path.
 *
 * PDF export used to navigate an offscreen window to
 * `data:text/html,${encodeURIComponent(html)}`, which is a poor fit once images
 * are inlined: percent-encoding inflates an already-base64 payload again, and
 * Chromium caps data-URL navigations, so an image-heavy note failed with a
 * generic error. A file has no such limit.
 *
 * The caller is responsible for removing it; `cleanupTempHtml` is the pair.
 */
export async function writeTempHtml(html: string): Promise<string> {
  const file = path.join(os.tmpdir(), `lumina-export-${randomUUID()}.html`)
  await fs.writeFile(file, html, 'utf8')
  return file
}

export async function cleanupTempHtml(file: string): Promise<void> {
  await fs.rm(file, { force: true }).catch(() => {})
}
