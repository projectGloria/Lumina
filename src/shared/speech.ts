/**
 * Turning a note into something worth listening to.
 *
 * Read-aloud speaks markdown, and markdown is full of characters that are not
 * words. A heading read verbatim opens with "number sign number sign", a
 * wikilink becomes "left bracket left bracket", a fenced code block is a solid
 * minute of punctuation, and `**bold**` is read as "asterisk asterisk". So the
 * source is stripped the way a reader's eye strips it before it reaches the
 * synthesizer.
 *
 * This is the pure half, and it lives here for the same reason `audio.ts` does:
 * the parts worth testing are the ones with no microphone, no speaker and no
 * DOM in them. Only the speaking itself is in the renderer.
 */

/**
 * Longest utterance handed to the synthesizer at once.
 *
 * Chunking is not cosmetic. Chromium's speech synthesis drops the tail of a
 * long utterance on some platform voices, `cancel()` only takes effect between
 * utterances (so stop and skip are as responsive as a chunk is short), and the
 * progress the player bar shows has to count *something*. ~220 characters is
 * roughly a spoken sentence or two, about ten seconds at normal rate.
 */
export const SPEECH_CHUNK_CHARS = 220

/** Fenced code, including an unterminated fence running to the end. */
const FENCE = /^[ \t]*(```+|~~~+)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|$)/gm

/**
 * Markdown source as prose a synthesizer can read.
 *
 * Structure is dropped rather than described — a listener does not want "level
 * two heading", they want the words. Code blocks, images, and HTML go entirely;
 * nothing there reads aloud as language.
 */
export function speechText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, '\n')

  // Frontmatter is metadata, not the note. Only at the very top, and only when
  // it is actually closed — a stray `---` further down is a horizontal rule.
  text = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')

  text = text.replace(FENCE, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = speechLine(raw)
    if (line !== null) lines.push(line)
  }

  return lines
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One line as prose, or null when the line is pure structure. */
function speechLine(raw: string): string | null {
  let line = raw

  // A blank line is a paragraph break, which `speechChunks` splits on.
  if (!line.trim()) return ''

  // Rules and table rulers carry no words at all.
  if (/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) return null
  if (/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/.test(line)) return null

  // A table row reads as its cells, separated the way a comma is read: as a
  // short pause. The pipes themselves are furniture.
  if (/^[ \t]*\|.*\|[ \t]*$/.test(line)) {
    line = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(', ')
  }

  line = line.replace(/^[ \t]*>+[ \t]?/g, '')
  line = line.replace(/^[ \t]*#{1,6}[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '')
  line = line.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, '')
  // A checkbox is state, not speech. Reading "left bracket x right bracket"
  // in front of every done task is the fastest way to make this unusable.
  line = line.replace(/^\[[ xX]\][ \t]*/, '')

  return speechInline(line)
}

/** Inline markers, links and tags as spoken words. */
function speechInline(input: string): string {
  let text = input

  // Embeds first: an image is `![alt](src)`, and running the link rule first
  // would leave a stray `!` behind.
  text = text.replace(/!\[\[[^\]]*\]\]/g, '')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // A wikilink reads as its alias, else its own last path segment without the
  // anchor — `[[Notes/Gloria#Plan|the plan]]` is "the plan", and with no alias
  // it is "Gloria", which is what the link looks like on screen.
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_all, target: string) => {
    const alias = target.split('|')[1]
    if (alias) return alias.trim()
    const name = target.split('|')[0].split('#')[0].trim()
    return name.split('/').pop() ?? name
  })

  // A markdown link reads as its text. The URL is not language.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[\^[^\]]*\]/g, '')
  text = text.replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, '')

  text = text.replace(/`+([^`]*)`+/g, '$1')
  text = text.replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
  // Single emphasis only when it actually wraps something, so `2 * 3` and
  // `snake_case_name` survive with their characters intact.
  text = text.replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '$1')
  text = text.replace(/(^|[^\w])_(\S(?:[^_\n]*\S)?)_(?=[^\w]|$)/g, '$1$2')

  // A tag is a word the writer chose; `#project/gloria` is read as the words,
  // not as "hash project slash gloria".
  text = text.replace(/(^|\s)#([\w/-]+)/g, (_all, lead: string, tag: string) =>
    lead + tag.replace(/[/_-]+/g, ' ')
  )

  text = text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')

  return text.trim()
}

/**
 * Prose split into utterances, each at most `max` characters.
 *
 * Sentences are the unit because they are what the pauses in speech are made
 * of; a fixed slice would breathe in the middle of a word. A sentence longer
 * than `max` is broken at a comma or a space rather than mid-word.
 */
export function speechChunks(text: string, max = SPEECH_CHUNK_CHARS): string[] {
  const out: string[] = []

  for (const block of text.split(/\n{2,}/)) {
    const paragraph = block.replace(/\n/g, ' ').trim()
    if (!paragraph) continue

    let current = ''
    const flush = (): void => {
      const done = current.trim()
      if (done) out.push(done)
      current = ''
    }

    for (const sentence of paragraph.split(/(?<=[.!?…:;])\s+/)) {
      const piece = sentence.trim()
      if (!piece) continue

      if (piece.length > max) {
        flush()
        for (const part of hardSplit(piece, max)) out.push(part)
        continue
      }

      if (current && current.length + 1 + piece.length > max) flush()
      current = current ? `${current} ${piece}` : piece
    }

    flush()
  }

  return out
}

/** A sentence too long to speak in one go, cut at the latest sane boundary. */
function hardSplit(sentence: string, max: number): string[] {
  const out: string[] = []
  let rest = sentence

  while (rest.length > max) {
    const window = rest.slice(0, max)
    const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' — '), window.lastIndexOf(' '))
    // No boundary at all (one enormous token, e.g. a URL): take the whole
    // window rather than loop forever.
    const cut = at > max * 0.4 ? at : max
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }

  if (rest) out.push(rest)
  return out
}
