import { describe, expect, it } from 'vitest'
import {
  fallbackLinkDetails,
  linkAccentIndex,
  parseLinkUrl,
  parseOgTags,
  standaloneLink,
  titleFromUrl
} from '@shared/linkPreview'

describe('fallbackLinkDetails', () => {
  it('gives YouTube links useful copy without fetched metadata', () => {
    expect(fallbackLinkDetails('https://www.youtube.com/watch?v=abc')).toEqual({
      title: 'YouTube',
      description: 'Watch this video on YouTube'
    })
  })

  it('gives Gemini links useful copy without fetched metadata', () => {
    expect(fallbackLinkDetails('https://gemini.google.com/app/example').title).toBe('Gemini')
  })
})

describe('parseLinkUrl', () => {
  it('drops www and a trailing slash', () => {
    expect(parseLinkUrl('https://www.github.com/')).toEqual({
      host: 'github.com',
      trail: '',
      monogram: 'G'
    })
  })

  it('keeps the path and query', () => {
    expect(parseLinkUrl('https://github.com/anthropics/claude?tab=readme').trail).toBe(
      '/anthropics/claude?tab=readme'
    )
  })

  it('survives something that is not a URL', () => {
    expect(parseLinkUrl('not a url').host).toBe('')
  })
})

describe('linkAccentIndex', () => {
  it('is stable for a host', () => {
    expect(linkAccentIndex('github.com')).toBe(linkAccentIndex('github.com'))
  })

  it('stays inside the palette', () => {
    for (const host of ['a.com', 'github.com', 'news.ycombinator.com', 'x.dev', '']) {
      const index = linkAccentIndex(host)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(6)
    }
  })
})

describe('titleFromUrl', () => {
  it('reads the last path segment', () => {
    expect(titleFromUrl('https://github.com/anthropics/claude-code')).toBe('claude code')
  })

  it('drops a file extension', () => {
    expect(titleFromUrl('https://example.com/docs/getting_started.html')).toBe('getting started')
  })

  it('falls back to the host for a bare domain', () => {
    expect(titleFromUrl('https://example.com')).toBe('example.com')
  })
})

describe('standaloneLink', () => {
  it('takes a bare URL on its own line', () => {
    expect(standaloneLink('https://github.com/x')).toEqual({ label: '', url: 'https://github.com/x' })
  })

  it('takes a markdown link on its own line, with the label', () => {
    expect(standaloneLink('  [Claude Code](https://claude.com/code)  ')).toEqual({
      label: 'Claude Code',
      url: 'https://claude.com/code'
    })
  })

  it('takes an autolink', () => {
    expect(standaloneLink('<https://example.com>')?.url).toBe('https://example.com')
  })

  it('leaves a link inside a sentence alone', () => {
    expect(standaloneLink('see https://example.com for more')).toBeNull()
    expect(standaloneLink('- https://example.com')).toBeNull()
    expect(standaloneLink('https://a.com https://b.com')).toBeNull()
  })

  it('ignores schemes with nothing to preview', () => {
    expect(standaloneLink('mailto:someone@example.com')).toBeNull()
    expect(standaloneLink('[[Some Note]]')).toBeNull()
  })
})

describe('parseOgTags', () => {
  const page = `
    <html><head>
      <title>Fallback &amp; Co</title>
      <meta property="og:title" content="Claude Code">
      <meta name="og:description" content="Agentic coding in your terminal">
      <meta property="og:image" content="https://claude.com/card.png">
    </head><body>ignored</body></html>`

  it('prefers Open Graph over the document title', () => {
    expect(parseOgTags(page).title).toBe('Claude Code')
  })

  it('reads description and image whichever attribute names them', () => {
    const tags = parseOgTags(page)
    expect(tags.description).toBe('Agentic coding in your terminal')
    expect(tags.image).toBe('https://claude.com/card.png')
  })

  it('falls back to <title>, entities decoded', () => {
    expect(parseOgTags('<html><head><title>Fallback &amp; Co</title></head>').title).toBe(
      'Fallback & Co'
    )
  })

  it('returns nothing for a page that says nothing', () => {
    expect(parseOgTags('<html><body>hi</body></html>')).toEqual({
      title: undefined,
      description: undefined,
      image: undefined
    })
  })
})
