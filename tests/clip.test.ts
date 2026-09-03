import { describe, expect, it } from 'vitest'
import { parseFrontmatter, extractTags } from '@shared/markdown-parse'
import {
  clipFrontmatter,
  clipNoteName,
  normalizeTag,
  validateClip,
  type ClipPayload
} from '@shared/clip'

/**
 * A clip arrives over HTTP from a browser extension, which makes it the least
 * trusted thing the app accepts — a title becomes a filename and a URL becomes
 * frontmatter. These cover the door it comes through rather than the server
 * around it, which is why `validateClip` is pure in the first place.
 */

const good = {
  mode: 'article',
  url: 'https://example.com/post',
  title: 'A post',
  html: '<p>Body</p>'
}

describe('validateClip', () => {
  it('accepts a well-formed clip', () => {
    const clip = validateClip(good)
    expect(clip).not.toBeNull()
    expect(clip?.mode).toBe('article')
    expect(clip?.url).toBe('https://example.com/post')
    expect(clip?.html).toBe('<p>Body</p>')
  })

  it('refuses anything that is not an object', () => {
    for (const raw of [null, undefined, 'clip', 42, [], [good]]) {
      expect(validateClip(raw)).toBeNull()
    }
  })

  it('refuses an unknown mode', () => {
    expect(validateClip({ ...good, mode: 'screenshot' })).toBeNull()
    expect(validateClip({ ...good, mode: undefined })).toBeNull()
    expect(validateClip({ ...good, mode: '__proto__' })).toBeNull()
  })

  it('refuses a URL that is not http(s)', () => {
    // A clip note links its source, so a `javascript:` or `file:` URL would be
    // written straight into the vault as a link.
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32',
      'data:text/html,<script>x</script>',
      'lumina://vault/secret.md',
      'not a url',
      ''
    ]) {
      expect(validateClip({ ...good, url })).toBeNull()
    }
  })

  it('refuses a body-carrying mode with no body', () => {
    // An empty note would look like the clipper had worked.
    for (const mode of ['article', 'full', 'selection']) {
      expect(validateClip({ ...good, mode, html: '' })).toBeNull()
      expect(validateClip({ ...good, mode, html: undefined })).toBeNull()
    }
  })

  it('allows a bookmark with no body, which is the whole point of one', () => {
    const clip = validateClip({ ...good, mode: 'bookmark', html: undefined })
    expect(clip?.mode).toBe('bookmark')
    expect(clip?.html).toBe('')
  })

  it('does not let an extra property ride along into the note', () => {
    const clip = validateClip({ ...good, folder: '../../etc', evil: true }) as unknown as Record<
      string,
      unknown
    >
    expect(clip.folder).toBeUndefined()
    expect(clip.evil).toBeUndefined()
  })

  it('treats a wrong type as a missing value rather than throwing', () => {
    const clip = validateClip({ ...good, title: 42, byline: {}, tags: 'nope', excerpt: null })
    expect(clip).not.toBeNull()
    expect(clip?.title).toBe('')
    expect(clip?.byline).toBe('')
    expect(clip?.tags).toEqual([])
  })

  it('strips control characters that would corrupt a filename or frontmatter', () => {
    const clip = validateClip({ ...good, title: 'Ti\u0000tle\nwith\u001fjunk' })
    expect(clip?.title).not.toMatch(/[\u0000\u001f]/)
  })

  it('drops an image URL that is not http(s), since it gets downloaded', () => {
    expect(validateClip({ ...good, image: 'javascript:alert(1)' })?.image).toBe('')
    expect(validateClip({ ...good, image: 'https://e.com/a.png' })?.image).toBe(
      'https://e.com/a.png'
    )
  })

  it('caps a title so it cannot become an unusable filename', () => {
    const clip = validateClip({ ...good, title: 'x'.repeat(5000) })
    expect(clip!.title.length).toBeLessThanOrEqual(300)
  })

  it('deduplicates and caps tags', () => {
    const clip = validateClip({ ...good, tags: ['a', 'a', '#a', ...Array(50).fill('b')] })
    expect(clip?.tags).toEqual(['a', 'b'])
  })

  it('defaults the timestamp rather than trusting a bad one', () => {
    expect(validateClip({ ...good, clippedAt: 'yesterday' })?.clippedAt).toBeTypeOf('number')
    expect(validateClip({ ...good, clippedAt: NaN })?.clippedAt).toBeTypeOf('number')
    expect(validateClip({ ...good, clippedAt: 1700000000000 })?.clippedAt).toBe(1700000000000)
  })
})

describe('normalizeTag', () => {
  it('produces a tag Lumina would find again', () => {
    expect(normalizeTag('#news')).toBe('news')
    expect(normalizeTag('  two words ')).toBe('two-words')
    expect(normalizeTag('a/b')).toBe('a/b')
  })

  it('rejects what the tag parser would not treat as a tag', () => {
    // `extractTags` deliberately reads `#1` as a number, so emitting one would
    // write a tag that never comes back.
    expect(normalizeTag('123')).toBe('')
    expect(normalizeTag('#')).toBe('')
    expect(normalizeTag('   ')).toBe('')
  })

  it('keeps letters outside ASCII', () => {
    expect(normalizeTag('yazılım')).toBe('yazılım')
  })
})

describe('clipNoteName', () => {
  it('strips every character a filesystem would refuse', () => {
    const name = clipNoteName('How to: A/B test "things" <now> | 50%?')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name).toContain('How to')
  })

  it('does not let a title become a path separator', () => {
    expect(clipNoteName('a/b/c')).not.toContain('/')
    expect(clipNoteName('a\\b')).not.toContain('\\')
  })

  it('trims trailing dots and spaces, which Windows silently drops', () => {
    expect(clipNoteName('Report...')).toBe('Report')
    expect(clipNoteName('  Spaced  ')).toBe('Spaced')
  })

  it('falls back to the host, then to a date, when there is no title', () => {
    expect(clipNoteName('', 'https://www.example.com/a')).toBe('example.com')
    expect(clipNoteName('', 'not a url', new Date('2026-03-04T10:00:00Z'))).toBe('Clip 2026-03-04')
  })

  it('sidesteps names Windows reserves', () => {
    expect(clipNoteName('CON')).toBe('CON clip')
    expect(clipNoteName('lpt1')).toBe('lpt1 clip')
  })

  it('caps the length', () => {
    expect(clipNoteName('x'.repeat(400)).length).toBeLessThanOrEqual(120)
  })
})

describe('clipFrontmatter', () => {
  const clip = (over: Partial<ClipPayload> = {}): ClipPayload =>
    ({ ...(validateClip(good) as ClipPayload), ...over })

  it('round-trips through the app\'s own frontmatter parser', () => {
    const block = clipFrontmatter(clip({ byline: 'A. Writer', siteName: 'Example' }))
    const { data } = parseFrontmatter(`${block}\nBody`)
    expect(data.source).toBe('https://example.com/post')
    expect(data.title).toBe('A post')
    expect(data.author).toBe('A. Writer')
    expect(data.site).toBe('Example')
  })

  it('writes tags the tag index actually picks up', () => {
    const block = clipFrontmatter(clip({ tags: ['news', 'reading'] }), ['clipped'])
    const parsed = parseFrontmatter(`${block}\nBody`)
    expect(parsed.data.tags).toEqual(['clipped', 'news', 'reading'])
    expect(extractTags(`${block}\nBody`, parsed.data)).toContain('clipped')
  })

  it('quotes a title the parser would otherwise coerce', () => {
    // `[Draft] 2024` looks like an inline array, and `true` like a boolean.
    for (const title of ['[Draft] 2024', 'true', '42', '#hashtag', '- dash']) {
      const parsed = parseFrontmatter(`${clipFrontmatter(clip({ title }))}\nBody`)
      expect(parsed.data.title).toBe(title)
    }
  })

  it('survives a title carrying a quote or a colon', () => {
    for (const title of ['He said "hi"', 'How to: win', 'back\\slash']) {
      const parsed = parseFrontmatter(`${clipFrontmatter(clip({ title }))}\nBody`)
      expect(String(parsed.data.title)).toContain(title.slice(0, 6).replace(/\\/, '\\'))
    }
  })

  it('always records the source, which is the point of a clip', () => {
    expect(clipFrontmatter(clip({ title: '', byline: '', siteName: '' }))).toContain(
      'source: https://example.com/post'
    )
  })

  it('omits fields the page did not provide rather than writing empties', () => {
    const block = clipFrontmatter(clip({ byline: '', siteName: '', tags: [] }))
    expect(block).not.toContain('author:')
    expect(block).not.toContain('site:')
    expect(block).not.toContain('tags:')
  })
})
