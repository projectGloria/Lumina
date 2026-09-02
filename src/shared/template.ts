/**
 * Placeholder expansion, shared by daily-note templates and the user's own
 * slash commands so both understand the same `{{...}}` vocabulary.
 *
 * Lives in `src/shared` for the same reason `slashItems.ts` does: it is pure,
 * so `tests/template.test.ts` can cover it without a DOM or the Zustand
 * stores. `lib/actions.ts` re-exports `formatDate` and `applyTemplate`, which
 * used to live there.
 */

/** Minimal date formatter covering the tokens the settings field advertises. */
export function formatDate(format: string, date = new Date()): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return format.replace(/YYYY|YY|MMMM|MMM|MM|DDDD|DDD|DD|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY': return String(date.getFullYear())
      case 'YY': return pad(date.getFullYear() % 100)
      case 'MMMM': return months[date.getMonth()]
      case 'MMM': return months[date.getMonth()].slice(0, 3)
      case 'MM': return pad(date.getMonth() + 1)
      case 'DDDD': return days[date.getDay()]
      case 'DDD': return days[date.getDay()].slice(0, 3)
      case 'DD': return pad(date.getDate())
      case 'HH': return pad(date.getHours())
      case 'mm': return pad(date.getMinutes())
      case 'ss': return pad(date.getSeconds())
      default: return token
    }
  })
}

/** Fill `{{date}}`, `{{time}}` and `{{title}}` in a template body. */
export function applyTemplate(body: string, title: string, now = new Date()): string {
  return body
    .replace(/\{\{\s*title\s*\}\}/g, title)
    .replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/g, (_m, fmt) => formatDate(fmt || 'YYYY-MM-DD', now))
    .replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/g, (_m, fmt) => formatDate(fmt || 'HH:mm', now))
}

export interface ExpandedSnippet {
  text: string
  /** Where the caret should land, as an offset into `text`. */
  cursor: number
}

/**
 * Expand a snippet body for insertion at the caret.
 *
 * Understands everything `applyTemplate` does, plus `{{cursor}}`, which marks
 * where the caret ends up. Only the first `{{cursor}}` positions the caret —
 * later ones are still removed, so a stray marker never survives into the
 * note. Without one the caret goes to the end, which is what you want for a
 * snippet you are about to keep typing after.
 */
export function expandSnippet(body: string, title = '', now = new Date()): ExpandedSnippet {
  const filled = applyTemplate(body, title, now)

  const CURSOR = /\{\{\s*cursor\s*\}\}/g
  const first = filled.search(CURSOR)
  const text = filled.replace(CURSOR, '')
  return { text, cursor: first === -1 ? text.length : first }
}

/**
 * Normalise what the user typed as a slash-command name into something the
 * `/` menu can actually match.
 *
 * The trigger in `editor/slashCommands.ts` stops at the first character
 * outside `[\w-]`, so a name with a space or punctuation in it would be
 * unreachable however carefully it was typed — better to drop those
 * characters when the command is saved than to offer a command that never
 * appears.
 */
export function slashCommandName(raw: string): string {
  return raw.trim().replace(/[^\w-]/g, '')
}
