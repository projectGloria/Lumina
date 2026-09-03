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
 * Rebasing goes through `rebaseDescendantPath` rather than doing its own
 * string work, because the case that catches naive prefix matching is not
 * rare: renaming `Notes` must move `Notes/Todo.md` and leave
 * `Notes backup/Todo.md` exactly where it is.
 */
import { rebaseDescendantPath } from './markdown-parse'
import type { TreeNode } from './types'

/**
 * What a widget declares if it stores a vault path in its options.
 *
 * Returns a patch to merge into the stored config, or null when this widget
 * held nothing that referred to the path — which is what keeps a rename
 * somewhere else in the vault from rewriting the board at all. A widget that
 * stores no path declares nothing and costs nothing.
 *
 * There is deliberately no counterpart for a *delete*. A path that has gone is
 * shown rather than cleared: the scratch pad draws its "not in this vault yet"
 * state and a folder filter says it names nothing, because editing the option
 * instead would silently repoint the card at something the user never chose.
 */
export interface WidgetPathHooks {
  /** `from` has been renamed or moved to `to`. */
  rebasePaths?: (
    config: Record<string, unknown>,
    from: string,
    to: string
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
