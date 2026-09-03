import { describe, expect, it } from 'vitest'
import {
  buildAliasMap,
  decodeTarget,
  encodeTarget,
  extractHeadings,
  extractLinks,
  extractTags,
  extractTasks,
  isMarkdownPath,
  isPathAtOrBelow,
  maskCode,
  parseFrontmatter,
  parseNote,
  rebaseDescendantPath,
  resolveLink,
  setTaskDone,
  stripExtension,
  titleFromPath
} from '@shared/markdown-parse'

describe('isMarkdownPath', () => {
  it('recognizes every supported note extension case-insensitively', () => {
    expect(isMarkdownPath('Note.md')).toBe(true)
    expect(isMarkdownPath('Note.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('Note.mdx')).toBe(true)
    expect(isMarkdownPath('Note.txt')).toBe(false)
    expect(isMarkdownPath('markdown')).toBe(false)
  })
})

describe('descendant path helpers', () => {
  it('distinguishes descendants from similarly prefixed siblings', () => {
    expect(isPathAtOrBelow('Old/Nested/note.md', 'Old')).toBe(true)
    expect(isPathAtOrBelow('Old', 'Old')).toBe(true)
    expect(isPathAtOrBelow('Old backup/note.md', 'Old')).toBe(false)
  })

  it('rebases a folder and all descendants without touching siblings', () => {
    expect(rebaseDescendantPath('Old/Nested/note.mdx', 'Old', 'New')).toBe(
      'New/Nested/note.mdx'
    )
    expect(rebaseDescendantPath('Old backup/note.md', 'Old', 'New')).toBe(
      'Old backup/note.md'
    )
  })
})

describe('maskCode', () => {
  it('blanks fenced blocks while preserving offsets', () => {
    const src = 'before\n```\n#nope\n```\nafter'
    const masked = maskCode(src)
    expect(masked.length).toBe(src.length)
    expect(masked).toContain('before')
    expect(masked).toContain('after')
    expect(masked).not.toContain('#nope')
  })

  it('blanks inline code spans', () => {
    const masked = maskCode('use `#hashtag` here')
    expect(masked).not.toContain('#hashtag')
    expect(masked.startsWith('use ')).toBe(true)
  })

  it('blanks indented code blocks', () => {
    const src = 'Try this:\n\n    :root { --accent: #4a7c59; }\n\nDone.'
    const masked = maskCode(src)
    expect(masked.length).toBe(src.length)
    expect(masked).not.toContain('4a7c59')
    expect(masked).toContain('Done.')
  })

  it('leaves indented list continuations alone', () => {
    const src = '- a list item\n    continued here with #realtag\n'
    expect(maskCode(src)).toContain('#realtag')
  })

  it('does not treat a wrapped paragraph line as code', () => {
    const src = 'A paragraph\n    that wrapped with #realtag\n'
    expect(maskCode(src)).toContain('#realtag')
  })
})

describe('parseFrontmatter', () => {
  it('reads scalars, inline arrays and list items', () => {
    const { data, lines } = parseFrontmatter(
      ['---', 'title: Hello', 'draft: true', 'count: 3', 'tags: [a, b]', 'aliases:', '  - one', '  - two', '---', '', 'Body'].join('\n')
    )
    expect(data.title).toBe('Hello')
    expect(data.draft).toBe(true)
    expect(data.count).toBe(3)
    expect(data.tags).toEqual(['a', 'b'])
    expect(data.aliases).toEqual(['one', 'two'])
    expect(lines).toBe(9)
  })

  it('keeps line numbers stable by blanking rather than removing', () => {
    const src = '---\ntitle: X\n---\n# Heading'
    const { body } = parseFrontmatter(src)
    expect(body.split('\n').length).toBe(src.split('\n').length)
    expect(extractHeadings(body)[0].line).toBe(3)
  })

  it('ignores a document with no closing fence', () => {
    const { data, body } = parseFrontmatter('---\ntitle: X\n\nstill going')
    expect(data).toEqual({})
    expect(body).toContain('title: X')
  })
})

describe('extractTags', () => {
  it('finds body tags and frontmatter tags', () => {
    const tags = extractTags('Work on #project/gloria today. #inbox', { tags: ['fromMatter'] })
    expect(tags).toContain('project/gloria')
    expect(tags).toContain('inbox')
    expect(tags).toContain('fromMatter')
  })

  it('does not treat headings or numbers as tags', () => {
    expect(extractTags('# Heading\n\nIssue #42')).toEqual([])
  })

  it('does not treat a mid-word hash as a tag', () => {
    expect(extractTags('colour#fff')).toEqual([])
  })
})

describe('extractLinks', () => {
  it('reads plain, aliased, anchored and embedded wikilinks', () => {
    const links = extractLinks('[[One]] and [[Two|second]] and [[Three#Section]] and ![[img.png]]')
    expect(links.map((l) => l.target)).toEqual(['One', 'Two', 'Three', 'img.png'])
    expect(links[1].alias).toBe('second')
    expect(links[2].anchor).toBe('Section')
    expect(links[3].kind).toBe('embed')
  })

  it('reads relative markdown links but skips external URLs', () => {
    const links = extractLinks('[a](notes/One.md) [b](https://example.com) [c](#anchor)')
    expect(links.map((l) => l.target)).toEqual(['notes/One.md'])
  })

  it('reports the line each link sits on', () => {
    const links = extractLinks('first\nsecond [[Target]]\nthird')
    expect(links[0].line).toBe(1)
  })

  it('ignores links inside code', () => {
    expect(extractLinks('`[[NotALink]]`')).toEqual([])
  })
})

describe('resolveLink', () => {
  const paths = ['Welcome.md', 'Projects/Gloria.md', 'Archive/Projects/Gloria.md', 'a/b/Deep.md']

  it('prefers an exact path match', () => {
    expect(resolveLink('Archive/Projects/Gloria', 'Welcome.md', paths)).toBe(
      'Archive/Projects/Gloria.md'
    )
  })

  it('prefers a note in the linking folder', () => {
    expect(resolveLink('Gloria', 'Archive/Projects/Notes.md', paths)).toBe(
      'Archive/Projects/Gloria.md'
    )
  })

  it('falls back to the shallowest match', () => {
    expect(resolveLink('Gloria', 'Welcome.md', paths)).toBe('Projects/Gloria.md')
  })

  it('tolerates an explicit extension', () => {
    expect(resolveLink('Welcome.md', 'Projects/Gloria.md', paths)).toBe('Welcome.md')
  })

  it('resolves relative targets against the source folder', () => {
    expect(resolveLink('../../Welcome', 'a/b/Deep.md', paths)).toBe('Welcome.md')
  })

  it('returns null when nothing matches', () => {
    expect(resolveLink('Nowhere', 'Welcome.md', paths)).toBeNull()
  })

  it('falls back to an alias when no filename matches', () => {
    const aliases = buildAliasMap([
      { path: 'Welcome.md', title: 'Welcome to Lumina', aliases: ['Start here'] }
    ])
    expect(resolveLink('Welcome to Lumina', 'Projects/Gloria.md', paths, aliases)).toBe('Welcome.md')
    expect(resolveLink('start HERE', 'Projects/Gloria.md', paths, aliases)).toBe('Welcome.md')
  })

  it('lets a real filename win over another note alias', () => {
    const aliases = buildAliasMap([
      { path: 'Welcome.md', title: 'Welcome', aliases: ['Gloria'] }
    ])
    expect(resolveLink('Gloria', 'Welcome.md', paths, aliases)).toBe('Projects/Gloria.md')
  })

  it('resolves a bare target to a .markdown or .mdx note', () => {
    const mixed = ['Notes/Legacy.markdown', 'Notes/Docs.mdx']
    expect(resolveLink('Legacy', 'Welcome.md', mixed)).toBe('Notes/Legacy.markdown')
    expect(resolveLink('Docs', 'Welcome.md', mixed)).toBe('Notes/Docs.mdx')
  })

  it('honours a spelled-out extension when two notes share a stem', () => {
    const twins = ['Note.md', 'Note.mdx']
    expect(resolveLink('Note.mdx', 'Other.md', twins)).toBe('Note.mdx')
    expect(resolveLink('Note.md', 'Other.md', twins)).toBe('Note.md')
  })
})

describe('stripExtension', () => {
  it('drops every extension isMarkdownPath accepts', () => {
    expect(stripExtension('Note.md')).toBe('Note')
    expect(stripExtension('Note.markdown')).toBe('Note')
    expect(stripExtension('Note.MDX')).toBe('Note')
  })

  it('leaves other extensions and bare names alone', () => {
    expect(stripExtension('diagram.png')).toBe('diagram.png')
    expect(stripExtension('Note')).toBe('Note')
    expect(stripExtension('markdown')).toBe('markdown')
  })

  it('gives a .markdown note a title without its extension', () => {
    expect(titleFromPath('Notes/Legacy.markdown')).toBe('Legacy')
  })
})

describe('buildAliasMap', () => {
  it('indexes titles and aliases case-insensitively, first claim winning', () => {
    const map = buildAliasMap([
      { path: 'A.md', title: 'Shared', aliases: ['one'] },
      { path: 'B.md', title: 'Shared', aliases: ['two'] }
    ])
    expect(map.get('shared')).toBe('A.md')
    expect(map.get('one')).toBe('A.md')
    expect(map.get('two')).toBe('B.md')
  })

  it('tolerates entries with no aliases field', () => {
    const map = buildAliasMap([{ path: 'A.md', title: 'Only title' }])
    expect(map.get('only title')).toBe('A.md')
  })
})

describe('parseNote aliases', () => {
  it('reads a list of aliases', () => {
    const note = parseNote('A.md', '---\naliases: [First, Second]\n---\n\nBody')
    expect(note.aliases).toEqual(['First', 'Second'])
  })

  it('accepts a single alias as a string', () => {
    expect(parseNote('A.md', '---\nalias: Just one\n---\n').aliases).toEqual(['Just one'])
  })

  it('defaults to an empty list', () => {
    expect(parseNote('A.md', 'no frontmatter').aliases).toEqual([])
  })
})

describe('parseNote', () => {
  const source = [
    '---',
    'title: Overridden',
    'tags: [meta]',
    '---',
    '',
    '# Actual heading',
    '',
    'Body with a [[Link]] and #tag and some words.',
    '',
    '## Second',
    '',
    '```js',
    'const notCounted = "[[NotALink]] #nottag"',
    '```'
  ].join('\n')

  const note = parseNote('Notes/Thing.md', source, 123)

  it('prefers the frontmatter title', () => {
    expect(note.title).toBe('Overridden')
    expect(note.mtime).toBe(123)
  })

  it('collects headings, tags and links, ignoring code', () => {
    expect(note.headings.map((h) => h.text)).toEqual(['Actual heading', 'Second'])
    expect(note.tags).toEqual(['meta', 'tag'])
    expect(note.links.map((l) => l.target)).toEqual(['Link'])
    expect(note.links[0].from).toBe('Notes/Thing.md')
    expect(note.links[0].to).toBeNull()
  })

  it('records the surrounding line as backlink context', () => {
    expect(note.links[0].context).toBe('Body with a [[Link]] and #tag and some words.')
  })

  it('counts words from prose only', () => {
    expect(note.wordCount).toBeGreaterThan(5)
    expect(note.wordCount).toBeLessThan(20)
  })

  it('falls back to the first H1, then the file name', () => {
    expect(parseNote('x.md', '# From heading').title).toBe('From heading')
    expect(parseNote('Folder/From file.md', 'no heading').title).toBe('From file')
  })
})

describe('encodeTarget / decodeTarget', () => {
  it('encodes a space so the destination does not end early', () => {
    // The whole point: `![a](attachments/Pasted image 1.png)` is not an image,
    // because CommonMark stops the destination at the first space.
    expect(encodeTarget('attachments/Pasted image 1.png')).toBe(
      'attachments/Pasted%20image%201.png'
    )
  })

  it('keeps the separators that make it a path', () => {
    expect(encodeTarget('a/b/c.png')).toBe('a/b/c.png')
  })

  it('encodes the characters a markdown destination cannot hold raw', () => {
    expect(encodeTarget('shots/screen (2).png')).toBe('shots/screen%20%282%29.png')
    expect(encodeTarget('shots/100%.png')).toBe('shots/100%25.png')
  })

  it('round-trips back to the real filename', () => {
    for (const path of ['a/Pasted image 1.png', 'a/100%.png', 'a/screen (2).png', 'plain.png']) {
      expect(decodeTarget(encodeTarget(path))).toBe(path)
    }
  })

  it('leaves a hand-written target with raw spaces alone', () => {
    expect(decodeTarget('attachments/my shot.png')).toBe('attachments/my shot.png')
  })

  it('returns a malformed escape unchanged instead of throwing', () => {
    expect(decodeTarget('attachments/50%off.png')).toBe('attachments/50%off.png')
  })

  it('normalises separators on the way out', () => {
    expect(decodeTarget('attachments\\deep\\x.png')).toBe('attachments/deep/x.png')
  })
})


describe('extractTasks', () => {
  it('reads open and done boxes off any list marker', () => {
    const src = ['- [ ] milk', '* [x] bread', '+ [X] jam', '1. [ ] tea', '2) [x] coffee'].join('\n')
    expect(extractTasks(src)).toEqual([
      { text: 'milk', done: false, line: 0 },
      { text: 'bread', done: true, line: 1 },
      { text: 'jam', done: true, line: 2 },
      { text: 'tea', done: false, line: 3 },
      { text: 'coffee', done: true, line: 4 }
    ])
  })

  it('keeps the source line so a change can be written back', () => {
    const src = ['# Plans', '', 'Some prose.', '', '   - [ ] nested chore'].join('\n')
    expect(extractTasks(src)).toEqual([{ text: 'nested chore', done: false, line: 4 }])
  })

  it('ignores a checkbox inside a fenced code block', () => {
    const src = ['- [ ] real', '```md', '- [ ] documentation', '```'].join('\n')
    expect(extractTasks(src)).toEqual([{ text: 'real', done: false, line: 0 }])
  })

  it('is not fooled by list items that only look like tasks', () => {
    const src = ['- [] no space', '- [-] partial', '- [ x] wide', 'text [ ] loose', '- plain'].join('\n')
    expect(extractTasks(src)).toEqual([])
  })

  it('keeps the task text exactly as written, trimmed', () => {
    expect(extractTasks('- [ ]   call [[Ana]] about **it**  ')).toEqual([
      { text: 'call [[Ana]] about **it**', done: false, line: 0 }
    ])
  })

  it('records an empty checkbox rather than dropping the line', () => {
    expect(extractTasks('- [ ] ')).toEqual([{ text: '', done: false, line: 0 }])
  })
})

describe('parseNote, tasks', () => {
  it('numbers tasks by their line in the whole note, frontmatter included', () => {
    const src = ['---', 'title: Chores', '---', '', '- [x] done thing', '- [ ] open thing'].join('\n')
    expect(parseNote('Chores.md', src).tasks).toEqual([
      { text: 'done thing', done: true, line: 4 },
      { text: 'open thing', done: false, line: 5 }
    ])
  })

  it('gives a note with no checkboxes an empty list', () => {
    expect(parseNote('Plain.md', '# Title\n\nJust prose.').tasks).toEqual([])
  })
})

describe('setTaskDone', () => {
  it('ticks a box without touching the rest of the line', () => {
    const src = ['- [ ] buy milk #errand', '- [ ] other'].join('\n')
    expect(setTaskDone(src, 0, true)).toBe(['- [x] buy milk #errand', '- [ ] other'].join('\n'))
  })

  it('unticks a box, whichever case it was written in', () => {
    expect(setTaskDone('  1. [X] filed', 0, false)).toBe('  1. [ ] filed')
  })

  it('preserves indentation, marker and trailing spacing', () => {
    expect(setTaskDone('\t* [ ]   spaced  ', 0, true)).toBe('\t* [x]   spaced  ')
  })

  it('refuses a line that is no longer a task', () => {
    // The index is a snapshot: a note edited since it was taken may have moved
    // the line, and ticking it blind would tick the wrong thing.
    expect(setTaskDone('- [ ] first\nplain prose', 1, true)).toBeNull()
    expect(setTaskDone('- [ ] first', 9, true)).toBeNull()
  })

  it('round-trips through the parser', () => {
    const src = ['- [ ] a', '- [x] b'].join('\n')
    const ticked = setTaskDone(src, 0, true)
    expect(ticked).not.toBeNull()
    expect(extractTasks(ticked as string).map((t) => t.done)).toEqual([true, true])
  })
})
