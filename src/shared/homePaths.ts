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
  /** `deleted` — a note, or a whole folder — has gone to the recycle bin. */
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
 * `fallback` is what the option means when it holds nothing, so a widget only
 * declares this where that is an honest answer. A task list filtered to a
 * folder that no longer exists is the case it is for: the card draws an empty
 * list with nothing to say why, and the filter is not visible anywhere except
 * the widget's own settings.
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
