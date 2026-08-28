import { describe, expect, it } from 'vitest'
import {
  buildAliasMap,
  extractHeadings,
  extractLinks,
  extractTags,
  maskCode,
  parseFrontmatter,
  parseNote,
  resolveLink
} from '@shared/markdown-parse'

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
