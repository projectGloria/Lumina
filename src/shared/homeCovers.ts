/**
 * Which of a board's pictures have stopped being its cover.
 *
 * `pickHomeCover` copies the chosen image into `<vault>/.lumina/home`, so
 * replacing or removing a cover leaves a file nothing refers to — and nothing
 * else in the app ever looks in that folder. Deleting them is therefore safe
 * in principle and delicate in practice: the pass is driven by the renderer's
 * debounced save, so the decision is kept here, pure, and the part in
 * `main/settings.ts` is only the file handling.
 */

/** The folder the board's own pictures live in, vault-relative. */
export const HOME_COVER_DIR = '.lumina/home'

/** One entry from that folder, as much of it as the decision needs. */
export interface CoverFile {
  name: string
  /** False for a directory or a symlink, neither of which is ours to delete. */
  isFile: boolean
  mtimeMs: number
}

export interface SweepOptions {
  /** The cover the board currently names, if it names one. */
  coverPath?: string
  now: number
  /**
   * How new a file may be and still be spared.
   *
   * Choosing a cover copies the file and *then* names it in the layout, and
   * saves are debounced — so a save that raced the pick carries a layout that
   * has not heard of the new file. Without this window that save would delete
   * the picture chosen a second ago.
   */
  graceMs: number
}

/** The names in `files` that can be deleted, in the order given. */
export function sweepableCovers(files: CoverFile[], options: SweepOptions): string[] {
  const { coverPath = '', now, graceMs } = options
  // Only a cover stored in this folder is one of these files; a layout edited
  // to point elsewhere in the vault leaves nothing here in use.
  const prefix = `${HOME_COVER_DIR}/`
  const keep =
    coverPath.startsWith(prefix) && !coverPath.slice(prefix.length).includes('/')
      ? coverPath.slice(prefix.length)
      : null

  return files
    .filter((file) => file.isFile && file.name !== keep && now - file.mtimeMs >= graceMs)
    .map((file) => file.name)
}
