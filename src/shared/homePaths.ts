/**
 * Vault paths stored inside a widget's options.
 *
 * `home.json` holds paths — the scratch pad's note, a task list's folder — so
 * a board is one more thing a rename has to move and a delete has to forget,
 * alongside buffers, tabs, `starred`, `pinned` and the icon overrides. A
 * widget declares what it stores through the hooks below and the walk over the
 * board is in `lib/actions.ts`; the rule for one stored value is here, where
 * it can be tested.
 *
 * Both rules go through `isPathAtOrBelow` and `rebaseDescendantPath` rather
 * than doing their own string work, because the case that catches naive prefix
 * matching is not rare: renaming `Notes` must move `Notes/Todo.md` and leave
 * `Notes backup/Todo.md` exactly where it is.
 */
import { isPathAtOrBelow, rebaseDescendantPath } from './markdown-parse'
import type { TreeNode } from './types'

/**
 * What a widget declares if it stores a vault path in its options.
 *
 * Both return a patch to merge into the stored config, or null when this
 * widget held nothing that referred to the path — which is what keeps a
 * rename somewhere else in the vault from rewriting the board at all. A widget
 * that stores no path declares neither and costs nothing.
 */
export interface WidgetPathHooks {
  /** `from` has been renamed or moved to `to`. */
  rebasePaths?: (
    config: Record<string, unknown>,
    from: string,
    to: string
  ) => Record<string, unknown> | null
  /**
   * `deleted` — a note, or a whole folder — has gone to the recycle bin.
   *
   * Only worth declaring where giving the path up is invisible *and* right: a
   * widget holding a *list* of paths, where a dead entry is noise, the way
   * `starred` and `pinned` drop theirs. A single option that decides what the
   * card shows should keep what the user stored and say it points at nothing
   * — see `useMissingFolder` in `home/widgets/FolderScope.tsx`. Clearing one
   * silently repoints the card at something else. Nothing declares this today.
   */
  forgetPaths?: (
    config: Record<string, unknown>,
    deleted: string
  ) => Record<string, unknown> | null
}

/** The stored value at `key`, if it is a path at all. */
function storedPath(config: Record<string, unknown>, key: string): string | null {
  const value = config[key]
  // Absent, the wrong type, or empty. Empty is not a missing path: it is how
  // the widgets that store a folder say "the whole vault".
  return typeof value === 'string' && value ? value : null
}

/**
 * Move the path at `config[key]` if `from` was renamed or moved to `to`.
 *
 * One rule covers both shapes a widget stores. A note path is moved when the
 * note itself is renamed or when any folder above it is; a folder path is
 * moved when that folder is renamed — `rebaseDescendantPath` handles the
 * value naming `from` exactly as well as it handles a descendant of it.
 */
export function rebaseConfigPath(
  config: Record<string, unknown>,
  key: string,
  from: string,
  to: string
): Record<string, unknown> | null {
  const value = storedPath(config, key)
  if (value === null) return null
  const next = rebaseDescendantPath(value, from, to)
  return next === value ? null : { [key]: next }
}

/**
 * Give up the path at `config[key]` if `deleted` took it away.
 *
 * `fallback` is what the option means when it holds nothing, and a widget
 * should only reach for this where that is an honest answer — which for the
 * two folder filters on this board it is not, so neither uses it. Clearing a
 * task list's folder repoints the card at the whole vault: forty rows arrive
 * where four used to be, from a card that looks like it is working, with the
 * reason discoverable only in the widget's own settings. They keep the folder
 * and say it names nothing instead.
 *
 * What this is for is a stored *list* of paths, where dropping a dead entry is
 * both invisible and correct, as `starred` and `pinned` already do.
 */
export function forgetConfigPath(
  config: Record<string, unknown>,
  key: string,
  deleted: string,
  fallback: string
): Record<string, unknown> | null {
  const value = storedPath(config, key)
  if (value === null || value === fallback) return null
  return isPathAtOrBelow(value, deleted) ? { [key]: fallback } : null
}

/**
 * Every folder in the vault, by vault-relative path.
 *
 * The counterpart to rebasing: a widget scoped to a folder needs to know when
 * that folder has stopped existing, so the card can say so instead of drawing
 * an empty list that looks like an answer. Read off the tree rather than the
 * index, so a real folder with nothing in it yet is still a folder — an index
 * only knows about notes.
 */
export function vaultFolders(tree: TreeNode[]): Set<string> {
  const found = new Set<string>()
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue
      found.add(node.path)
      walk(node.children)
    }
  }
  walk(tree)
  return found
}
