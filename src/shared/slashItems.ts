/**
 * The slash-command item shape and the pure ranking logic over it.
 *
 * Lives in `src/shared` rather than next to `editor/slashCommands.ts` because
 * that file pulls in `lib/commands.ts`, which reaches the Zustand stores,
 * which touch `window` at module scope (see `settingsStore.ts`'s
 * `systemDark`) — so it cannot be imported from a node-only vitest test. This
 * module carries no such dependency and `tests/slash-items.test.ts` covers it
 * directly, the same way `markdown-parse.ts` is tested.
 */
export interface SlashItem {
  id: string
  label: string
  detail: string
  group: 'Format' | 'Insert' | 'Custom'
  apply: (view: unknown, from: number, to: number) => void
}

/**
 * A snippet the user defined in settings, stored app-level so it follows them
 * between vaults (see `AppState.slashCommands` in `main/settings.ts`).
 */
export interface CustomSlashCommand {
  id: string
  /** What you type after the slash, and the label in the menu. */
  name: string
  description: string
  /** Snippet text, with `{{date}}`, `{{time}}`, `{{title}}` and `{{cursor}}`. */
  body: string
}

/**
 * Rank items for a query: prefix matches ahead of substring matches, groups
 * kept together (Format, then Insert, then the user's own) within a score
 * tier, alphabetical within a group. Empty query returns every item, grouped.
 */
export function matchSlashItems<T extends Pick<SlashItem, 'label' | 'group'>>(
  query: string,
  items: readonly T[]
): T[] {
  const q = query.toLowerCase()
  const groupOrder: Record<SlashItem['group'], number> = { Format: 0, Insert: 1, Custom: 2 }

  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const label = item.label.toLowerCase()
    let score: number
    if (!q) score = 0
    else if (label.startsWith(q)) score = 2
    else if (label.includes(q)) score = 1
    else if (isSubsequence(q, label)) score = 0
    else continue
    scored.push({ item, score })
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      groupOrder[a.item.group] - groupOrder[b.item.group] ||
      a.item.label.localeCompare(b.item.label)
  )
  return scored.map((s) => s.item)
}

/** Loose matching keeps the menu useful for compact searches such as `h1`. */
function isSubsequence(query: string, label: string): boolean {
  let at = 0
  for (const char of label) {
    if (char === query[at]) at++
    if (at === query.length) return true
  }
  return false
}
