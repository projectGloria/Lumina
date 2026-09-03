import { describe, expect, it } from 'vitest'
import { SPEECH_CHUNK_CHARS, speechChunks, speechText } from '@shared/speech'

describe('speechText', () => {
  it('drops the syntax a synthesizer would read out as punctuation', () => {
    const source = [
      '---',
      'title: Gloria',
      '---',
      '',
      '## The **plan**',
      '',
      'See [[Notes/Gloria#Phase one|the first phase]] and [[Ideas]].',
      'Read the [docs](https://example.com/deep/link) before ==starting==.'
    ].join('\n')

    expect(speechText(source)).toBe(
      [
        'The plan',
        '',
        'See the first phase and Ideas.',
        'Read the docs before starting.'
      ].join('\n')
    )
  })

  it('skips code blocks entirely, including an unterminated one', () => {
    expect(speechText('Before\n\n```ts\nconst x = 1\n```\n\nAfter')).toBe('Before\n\nAfter')
    expect(speechText('Before\n\n```\nnever closed')).toBe('Before')
  })

  it('reads list items and tasks as their words', () => {
    expect(speechText('- one\n- [x] two\n1. three')).toBe('one\ntwo\nthree')
  })

  it('reads a table as its cells and drops the ruler', () => {
    const table = '| Build | Time |\n| --- | ---: |\n| CPU | 6.8 s |'
    expect(speechText(table)).toBe('Build, Time\nCPU, 6.8 s')
  })

  it('reads a tag as the words in it', () => {
    expect(speechText('Filed under #project/gloria today')).toBe(
      'Filed under project gloria today'
    )
  })

  it('leaves characters that only look like markers alone', () => {
    expect(speechText('2 * 3 is 6, and snake_case_name stays')).toBe(
      '2 * 3 is 6, and snake_case_name stays'
    )
  })

  it('drops embeds, which have nothing to say', () => {
    expect(speechText('![alt](attachments/a.png)\n\n![[note.png]]\n\nWords')).toBe('Words')
  })

  it('keeps a horizontal rule from being read as dashes', () => {
    expect(speechText('One\n\n---\n\nTwo')).toBe('One\n\nTwo')
  })
})

describe('speechChunks', () => {
  it('splits on sentences once a chunk is full', () => {
    expect(speechChunks('One thing. Two things! Three?', 12)).toEqual([
      'One thing.',
      'Two things!',
      'Three?'
    ])
  })

  it('packs short sentences together rather than one utterance each', () => {
    expect(speechChunks('A. B. C.', 40)).toEqual(['A. B. C.'])
  })

  it('never exceeds the limit, even for one long sentence', () => {
    const sentence = `${'word '.repeat(200).trim()}.`
    const chunks = speechChunks(sentence)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SPEECH_CHUNK_CHARS)
    expect(chunks.join(' ')).toBe(sentence)
  })

  it('breaks an unbroken token rather than looping forever', () => {
    const chunks = speechChunks('x'.repeat(500), 100)
    expect(chunks).toHaveLength(5)
    expect(chunks.every((chunk) => chunk.length === 100)).toBe(true)
  })

  it('keeps paragraphs apart and ignores empty ones', () => {
    expect(speechChunks('One\n\n\n\nTwo')).toEqual(['One', 'Two'])
  })

  it('has nothing to say about an empty note', () => {
    expect(speechChunks(speechText('---\ntitle: x\n---\n'))).toEqual([])
  })
})
