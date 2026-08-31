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
  insertTable
} from './format'
import { matchSlashItems } from '@shared/slashItems'

export interface SlashItem {
  id: string
  label: string
  detail: string
  group: 'Format' | 'Insert'
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
  detail: '',
  group: 'Format',
  apply: () => runCommand(c.id)
}))

const BLOCK_ITEMS: SlashItem[] = [
  {
    id: 'insert.table',
    label: 'Table',
    detail: 'Insert a table',
    group: 'Insert',
    apply: (view, from, to) => insertTable(view, from, to)
  },
  {
    id: 'insert.callout',
    label: 'Callout',
    detail: 'Insert a callout',
    group: 'Insert',
    apply: (view, from, to) => insertCallout(view, from, to)
  },
  {
    id: 'insert.codeFence',
    label: 'Code block',
    detail: 'Insert a fenced code block',
    group: 'Insert',
    apply: (view, from, to) => insertCodeFence(view, from, to)
  },
  {
    id: 'insert.divider',
    label: 'Divider',
    detail: 'Insert a horizontal rule',
    group: 'Insert',
    apply: (view, from, to) => insertDivider(view, from, to)
  },
  {
    id: 'insert.date',
    label: 'Date',
    detail: "Insert today's date",
    group: 'Insert',
    apply: (view, from, to) => insertDate(view, from, to)
  }
]

export const SLASH_ITEMS: SlashItem[] = [...COMMAND_ITEMS, ...BLOCK_ITEMS]

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
 */
export function slashCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\/[a-zA-Z]*/)
  if (!before) return null

  const charBefore = context.state.sliceDoc(Math.max(0, before.from - 1), before.from)
  const line = context.state.doc.lineAt(before.from)
  const atLineStart = before.from === line.from
  if (!atLineStart && charBefore !== ' ' && charBefore !== '\t') return null

  if (before.from === before.to && !context.explicit) return null
  if (insideRejectedNode(context)) return null

  const query = before.text.slice(1)
  const matches = matchSlashItems(query, SLASH_ITEMS)
  if (!matches.length) return null

  const from = before.from
  const options: Completion[] = matches.map((item) => ({
    label: item.label,
    detail: item.detail,
    type: item.group === 'Insert' ? 'class' : 'keyword',
    boost: item.group === 'Format' ? 1 : 0,
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      // Remove the `/query` first so a block command like `/h1` never ends
      // up inserted inside the heading it is about to create.
      view.dispatch({ changes: { from, to: applyTo, insert: '' } })
      item.apply(view, from, from)
    }
  }))

  return {
    from,
    options,
    validFor: /^\/[a-zA-Z]*$/
  }
}
