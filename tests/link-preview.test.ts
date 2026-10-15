import { describe, expect, it } from 'vitest'
import {
  parseLinkUrl,
  titleFromUrl,
  standaloneLink,
  parseOgTags,
  fallbackLinkDetails
} from '../src/shared/linkPreview'

describe('parseLinkUrl', () => {
  it('extracts host, trail, and monogram', () => {
    const parts = parseLinkUrl('https://www.github.com/nihil/lumina?tab=readme')
    expect(parts.host).toBe('github.com')
    expect(parts.trail).toBe('/nihil/lumina?tab=readme')
    expect(parts.monogram).toBe('G')
  })

  it('handles bare domains and invalid URLs', () => {
    const bare = parseLinkUrl('https://example.com/')
    expect(bare.host).toBe('example.com')
    expect(bare.trail).toBe('')

    const invalid = parseLinkUrl('not-a-url')
    expect(invalid.host).toBe('')
    expect(invalid.trail).toBe('')
    expect(invalid.monogram).toBe('?')
  })
})

describe('titleFromUrl', () => {
  it('derives readable titles from path segments', () => {
    expect(titleFromUrl('https://example.com/blog/getting-started_guide.html')).toBe('getting started guide')
    expect(titleFromUrl('https://example.com/')).toBe('example.com')
  })
})

describe('standaloneLink', () => {
  it('does not trigger on plain URLs or regular markdown links', () => {
    expect(standaloneLink('https://example.com')).toBeNull()
    expect(standaloneLink('http://example.com/docs')).toBeNull()
    expect(standaloneLink('[Example](https://example.com)')).toBeNull()
    expect(standaloneLink('Read [here](https://example.com) for details')).toBeNull()
  })

  it('recognizes explicit banner link syntax', () => {
    expect(standaloneLink('[banner](https://example.com)')).toEqual({
      label: '',
      url: 'https://example.com'
    })

    expect(standaloneLink('[banner: Custom Headline](https://example.com/post)')).toEqual({
      label: 'Custom Headline',
      url: 'https://example.com/post'
    })

    expect(standaloneLink('[card](https://example.com)')).toEqual({
      label: '',
      url: 'https://example.com'
    })

    expect(standaloneLink('[bookmark](https://example.com)')).toEqual({
      label: '',
      url: 'https://example.com'
    })

    expect(standaloneLink('  [banner](https://example.com)  ')).toEqual({
      label: '',
      url: 'https://example.com'
    })
  })

  it('recognizes #banner URL hash syntax', () => {
    expect(standaloneLink('[Project Lumina](https://github.com/example/lumina#banner)')).toEqual({
      label: 'Project Lumina',
      url: 'https://github.com/example/lumina'
    })
  })

  it('rejects banner syntax when surrounded by text on the same line', () => {
    expect(standaloneLink('Here is a card: [banner](https://example.com)')).toBeNull()
    expect(standaloneLink('[banner](https://example.com) and some text')).toBeNull()
  })
})

describe('parseOgTags', () => {
  it('extracts Open Graph and Twitter tags', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Fallback Title</title>
        <meta property="og:title" content="OG Headline &amp; More" />
        <meta property="og:description" content="OG Description &quot;Quotes&quot;" />
        <meta property="og:image:secure_url" content="https://example.com/og-secure.jpg" />
      </head>
      <body></body>
      </html>
    `
    const meta = parseOgTags(html)
    expect(meta.title).toBe('OG Headline & More')
    expect(meta.description).toBe('OG Description "Quotes"')
    expect(meta.image).toBe('https://example.com/og-secure.jpg')
  })

  it('falls back to standard html title and meta description', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Plain Site Title</title>
        <meta name="description" content="Plain meta description" />
      </head>
      <body></body>
      </html>
    `
    const meta = parseOgTags(html)
    expect(meta.title).toBe('Plain Site Title')
    expect(meta.description).toBe('Plain meta description')
    expect(meta.image).toBeUndefined()
  })

  it('supports twitter tags as fallback', () => {
    const html = `
      <meta name="twitter:title" content="Twitter Card Title" />
      <meta name="twitter:description" content="Twitter description" />
      <meta name="twitter:image:src" content="https://example.com/twitter-card.png" />
    `
    const meta = parseOgTags(html)
    expect(meta.title).toBe('Twitter Card Title')
    expect(meta.description).toBe('Twitter description')
    expect(meta.image).toBe('https://example.com/twitter-card.png')
  })
})

describe('fallbackLinkDetails', () => {
  it('provides brand-specific fallbacks', () => {
    expect(fallbackLinkDetails('https://www.youtube.com/watch?v=123').title).toBe('YouTube')
    expect(fallbackLinkDetails('https://gemini.google.com/app').title).toBe('Gemini')
  })
})
