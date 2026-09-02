/**
 * Slash commands (`/heading`, `/table`, ...), built on the same
 * `autocompletion()` source mechanism as `wikilinkCompletion` and
 * `tagCompletion` (see `extensions.ts`) — that gets the popup, filtering,
 * arrow-key navigation, Escape and `.cm-tooltip-autocomplete` styling for
 * free, so this file only supplies items and a trigger.
 *
 * Items reuse the `Editor`-section entries in the command registry
 * (`lib/commands.ts`) for anything that already exists there — bold, italic,
 * headings, quote, lists, task — plus block inserts that have no other
 * trigger (table, callout, code fence, divider, date).
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { COMMANDS, runCommand } from '../lib/commands'
import {
  insertCallout,
  insertCodeFence,
  insertDate,
  insertDivider,
  insertMathBlock,
  insertTable
} from './format'
import { matchSlashItems } from '@shared/slashItems'
import { expandSnippet } from '@shared/template'
import { useSettings } from '../store/settingsStore'
import { titleOf } from '../store/vaultStore'
import { createIconElement, type IconName } from '../components/Icon'

export interface SlashItem {
  id: string
  label: string
  detail: string
  group: 'Format' | 'Insert' | 'Custom'
  icon: IconName
  apply: (view: EditorView, from: number, to: number) => void
}

// Duplicate-line is a line operation, not something you'd insert at the
// cursor mid-sentence, so it stays out of the slash menu even though it is
// an Editor-section command.
const EXCLUDED_COMMAND_IDS = new Set(['editor.duplicateLine'])

const COMMAND_ITEMS: SlashItem[] = COMMANDS.filter(
  (c) => c.section === 'Editor' && !EXCLUDED_COMMAND_IDS.has(c.id)
).map((c) => ({
  id: c.id,
  label: c.title,
  detail: c.description ?? `Apply ${c.title.toLowerCase()}`,
  group: 'Format',
  icon: c.icon ?? 'edit',
  apply: () => runCommand(c.id)
}))

const BLOCK_ITEMS: SlashItem[] = [
  {
    id: 'insert.table',
    label: 'Table',
    detail: 'Insert a table',
    group: 'Insert',
    icon: 'outline',
    apply: (view, from, to) => insertTable(view, from, to)
  },
  {
    id: 'insert.callout',
    label: 'Callout',
    detail: 'Insert a callout',
    group: 'Insert',
    icon: 'info',
    apply: (view, from, to) => insertCallout(view, from, to)
  },
  {
    id: 'insert.codeFence',
    label: 'Code block',
    detail: 'Insert a fenced code block',
    group: 'Insert',
    icon: 'slash',
    apply: (view, from, to) => insertCodeFence(view, from, to)
  },
  {
    id: 'insert.divider',
    label: 'Divider',
    detail: 'Insert a horizontal rule',
    group: 'Insert',
    icon: 'outline',
    apply: (view, from, to) => insertDivider(view, from, to)
  },
  {
    id: 'insert.date',
    label: 'Date',
    detail: "Insert today's date",
    group: 'Insert',
    icon: 'clock',
    apply: (view, from, to) => insertDate(view, from, to)
  },
  {
    id: 'insert.math',
    label: 'Math block',
    detail: 'Insert a $$ ... $$ math block',
    group: 'Insert',
    icon: 'hash',
    apply: (view, from, to) => insertMathBlock(view, from, to)
  }
]

export const SLASH_ITEMS: SlashItem[] = [...COMMAND_ITEMS, ...BLOCK_ITEMS]

/**
 * The user's own snippets, read fresh on every keystroke rather than captured
 * at module scope — a command added in settings has to show up in the menu
 * without reloading the editor.
 */
function customItems(path: string): SlashItem[] {
  return useSettings.getState().settings.slashCommands
    .filter((command) => command.name.trim())
    .map((command) => ({
      id: `custom.${command.id}`,
      label: command.name,
      detail: command.description || 'Insert your custom snippet',
      group: 'Custom' as const,
      icon: 'bolt',
      apply: (view: EditorView, from: number) => {
        const { text, cursor } = expandSnippet(command.body, titleOf(path))
        view.dispatch({
          changes: { from, insert: text },
          selection: { anchor: from + cursor },
          scrollIntoView: true
        })
      }
    }))
}

function slashInfo(item: SlashItem): HTMLElement {
  const info = document.createElement('div')
  info.className = 'slash-command-info'

  const heading = document.createElement('div')
  heading.className = 'slash-command-info-heading'
  heading.appendChild(createIconElement(item.icon, 15))

  const title = document.createElement('strong')
  title.textContent = item.label
  heading.appendChild(title)

  const group = document.createElement('span')
  group.className = 'slash-command-info-group'
  group.textContent = item.group
  heading.appendChild(group)
  info.appendChild(heading)

  const detail = document.createElement('div')
  detail.className = 'slash-command-info-detail'
  detail.textContent = item.detail
  info.appendChild(detail)
  return info
}

const SLASH_REJECTED_NODES = new Set(['FencedCode', 'CodeText', 'InlineCode', 'CodeBlock', 'WikiLink', 'Link'])

/** True when `pos` sits inside a node the slash menu should stay out of. */
function insideRejectedNode(context: CompletionContext): boolean {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1)
  while (node) {
    if (SLASH_REJECTED_NODES.has(node.name)) return true
    node = node.parent
  }
  return false
}

/**
 * Suggest a slash command after `/` at the start of a line or after
 * whitespace — not mid-word, or `https://` would pop the menu on every link.
 *
 * Takes the note's path so a custom snippet can fill `{{title}}`; the result
 * is the completion source `extensions.ts` hands to `autocompletion()`.
 */
export function slashCompletion(path: string) {
  return (context: CompletionContext): CompletionResult | null => slashSource(context, path)
}

function slashSource(context: CompletionContext, path: string): CompletionResult | null {
  // Keep searching through every keystroke on this line. This supports full
  // labels such as `/heading 1` as well as compact queries such as `/h1`.
  const before = context.matchBefore(/\/[^\n]*/)
  if (!before) return null

  const charBefore = context.state.sliceDoc(Math.max(0, before.from - 1), before.from)
  const line = context.state.doc.lineAt(before.from)
  const atLineStart = before.from === line.from
  if (!atLineStart && charBefore !== ' ' && charBefore !== '\t') return null

  if (before.from === before.to && !context.explicit) return null
  if (insideRejectedNode(context)) return null

  const query = before.text.slice(1)
  const matches = matchSlashItems(query, [...SLASH_ITEMS, ...customItems(path)])
  if (!matches.length) return null

  const from = before.from
  const options: Completion[] = matches.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: item.group === 'Custom' ? 'variable' : item.group === 'Insert' ? 'class' : 'keyword',
    boost: item.group === 'Format' ? 1 : 0,
    info: () => slashInfo(item),
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      // Remove the `/query` first so a block command like `/h1` never ends
      // up inserted inside the heading it is about to create.
      view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: '' } })
      item.apply(view, applyFrom, applyFrom)
    }
  }))

  return {
    from,
    options,
    // `matchSlashItems` has already ranked and filtered against the query.
    // Leaving CodeMirror's own filter on would then re-filter the labels
    // against the typed text *including* the leading slash, which no label
    // can match — the menu emptied itself the moment you typed a letter.
    filter: false,
    // With filtering delegated to `matchSlashItems`, a cached completion set
    // must expire as soon as the text changes so the source can re-rank it.
    validFor: (text) => text === before.text
  }
}
