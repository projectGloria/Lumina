import MiniSearch from 'minisearch'
import type { SearchHit } from '@shared/types'
import { readNote } from './vault'

interface Doc {
  path: string
  title: string
  tags: string
  body: string
}

const options = {
  idField: 'path',
  fields: ['title', 'tags', 'body'],
  storeFields: ['title'],
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    boost: { title: 4, tags: 2 },
    combineWith: 'AND' as const
  }
}

let mini = new MiniSearch<Doc>(options)

export function resetSearch(): void {
  mini = new MiniSearch<Doc>(options)
}

export function serializeSearch(): string {
  return JSON.stringify(mini)
}

/** Restore a previously serialized index. Returns false if it is unusable. */
export function loadSearch(json: string): boolean {
  try {
    mini = MiniSearch.loadJSON<Doc>(json, options)
    return true
  } catch {
    mini = new MiniSearch<Doc>(options)
    return false
  }
}

export function upsertDoc(path: string, title: string, tags: string[], body: string): void {
  const doc: Doc = { path, title, tags: tags.join(' '), body }
  if (mini.has(path)) mini.replace(doc)
  else mini.add(doc)
}

export function removeDoc(path: string): void {
  if (mini.has(path)) mini.discard(path)
}

/** Escape a string for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Pull the lines of a note that actually contain the query terms.
 *
 * MiniSearch tells us which notes match; this re-reads only the top hits to
 * show where the match is, which keeps memory flat regardless of vault size.
 */
async function lineMatches(path: string, terms: string[], phrase: string | null) {
  const res = await readNote(path)
  if (!res.ok || !res.data) return []

  const needles = phrase ? [phrase] : terms
  if (!needles.length) return []
  const re = new RegExp(needles.map(escapeRe).join('|'), 'gi')

  const out: SearchHit['matches'] = []
  const lines = res.data.content.split('\n')
  for (let i = 0; i < lines.length && out.length < 5; i++) {
    re.lastIndex = 0
    const m = re.exec(lines[i])
    if (!m) continue
    const raw = lines[i]
    // Keep the snippet short but centred on the match.
    const start = Math.max(0, m.index - 40)
    const text = (start > 0 ? '…' : '') + raw.slice(start, start + 160).trim()
    out.push({
      line: i,
      text,
      from: m.index - start + (start > 0 ? 1 : 0),
      to: m.index - start + m[0].length + (start > 0 ? 1 : 0)
    })
  }
  return out
}

export async function search(query: string, limit = 60): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // "quoted phrase" searches match literally rather than by term.
  const quoted = trimmed.match(/^"(.+)"$/)
  const phrase = quoted ? quoted[1] : null
  const terms = (phrase ?? trimmed).split(/\s+/).filter(Boolean)

  const raw = mini.search(phrase ?? trimmed, phrase ? { combineWith: 'AND', prefix: false } : {})
  const top = raw.slice(0, limit)

  const hits = await Promise.all(
    top.map(async (r) => ({
      path: r.id as string,
      title: (r as unknown as { title: string }).title,
      score: r.score,
      matches: await lineMatches(r.id as string, terms, phrase)
    }))
  )

  // A phrase search only counts if the phrase is really on a line somewhere.
  return phrase ? hits.filter((h) => h.matches.length > 0) : hits
}

/** Note titles for the quick switcher, ranked by fuzzy title match. */
export function searchTitles(query: string, limit = 30): { path: string; title: string }[] {
  const q = query.trim()
  if (!q) return []
  return mini
    .search(q, { fields: ['title'], prefix: true, fuzzy: 0.3 })
    .slice(0, limit)
    .map((r) => ({ path: r.id as string, title: (r as unknown as { title: string }).title }))
}
