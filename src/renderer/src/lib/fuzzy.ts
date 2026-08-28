/**
 * Subsequence matching for the quick switcher and command palette.
 *
 * Kept in the renderer rather than going through the search index, because a
 * picker has to feel instant on every keystroke and the note list is already
 * in memory.
 */

export interface FuzzyMatch {
  score: number
  /** Indices in the haystack that matched, for highlighting. */
  indices: number[]
}

/**
 * Score `query` against `text`, or return null when it does not match.
 *
 * Consecutive runs and matches at word boundaries are rewarded, so "cfg"
 * ranks `Config file` above `Cheerful graphics`.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] }

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // A plain substring is always the best kind of match.
  const direct = t.indexOf(q)
  if (direct !== -1) {
    const boundary = direct === 0 || /[\s/_-]/.test(t[direct - 1])
    return {
      score: 1000 - direct + (boundary ? 200 : 0) + Math.max(0, 60 - text.length),
      indices: Array.from({ length: q.length }, (_, i) => direct + i)
    }
  }

  const indices: number[] = []
  let score = 0
  let ti = 0
  let run = 0

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti
        break
      }
      ti++
    }
    if (found === -1) return null

    const boundary = found === 0 || /[\s/_-]/.test(t[found - 1])
    run = indices.length && indices[indices.length - 1] === found - 1 ? run + 1 : 0
    score += 10 + run * 8 + (boundary ? 25 : 0)
    indices.push(found)
    ti = found + 1
  }

  // Shorter haystacks win ties: a match filling most of the title is stronger.
  return { score: score + Math.max(0, 40 - text.length), indices }
}

/** Split text into plain and matched segments for rendering. */
export function highlight(text: string, indices: number[]): { text: string; hit: boolean }[] {
  if (!indices.length) return [{ text, hit: false }]
  const set = new Set(indices)
  const out: { text: string; hit: boolean }[] = []
  let current = ''
  let currentHit = set.has(0)

  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== currentHit) {
      if (current) out.push({ text: current, hit: currentHit })
      current = ''
      currentHit = hit
    }
    current += text[i]
  }
  if (current) out.push({ text: current, hit: currentHit })
  return out
}
