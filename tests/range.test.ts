import { describe, expect, it } from 'vitest'
import { contentRange, parseByteRange } from '../src/main/range'

const SIZE = 1000

describe('parseByteRange', () => {
  it('reads a closed range', () => {
    expect(parseByteRange('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=200-299', SIZE)).toEqual({ start: 200, end: 299 })
  })

  // What a player sends when it starts streaming from a seek point.
  it('reads an open-ended range as "to the end"', () => {
    expect(parseByteRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 })
  })

  // `bytes=-500` is the last 500 bytes, not the first. Backwards here would
  // serve the opening of a file to something asking for its end.
  it('reads a suffix range as the last N bytes', () => {
    expect(parseByteRange('bytes=-500', SIZE)).toEqual({ start: 500, end: 999 })
    expect(parseByteRange('bytes=-1', SIZE)).toEqual({ start: 999, end: 999 })
  })

  it('clamps a suffix longer than the file', () => {
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past the last byte', () => {
    expect(parseByteRange('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('tolerates whitespace and case', () => {
    expect(parseByteRange('  BYTES= 10 - 20 ', SIZE)).toEqual({ start: 10, end: 20 })
  })

  it('says nothing at all when there is no range to honour', () => {
    expect(parseByteRange(null, SIZE)).toBeNull()
    expect(parseByteRange(undefined, SIZE)).toBeNull()
    expect(parseByteRange('', SIZE)).toBeNull()
    expect(parseByteRange('items=0-99', SIZE)).toBeNull()
    expect(parseByteRange('bytes=abc', SIZE)).toBeNull()
    expect(parseByteRange('bytes=', SIZE)).toBeNull()
    expect(parseByteRange('bytes=1-2-3', SIZE)).toBeNull()
    expect(parseByteRange('bytes=-', SIZE)).toBeNull()
  })

  // Legal to answer with the whole representation, and far simpler than
  // assembling a multipart body nothing here is going to ask for.
  it('sends the whole file for a multi-range request', () => {
    expect(parseByteRange('bytes=0-99,200-299', SIZE)).toBeNull()
  })

  // A 416, not a 200: handing a media element bytes it did not ask for and
  // cannot place is worse than refusing.
  it('refuses a range that starts past the end', () => {
    expect(parseByteRange('bytes=1000-1099', SIZE)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=5000-', SIZE)).toBe('unsatisfiable')
  })

  it('refuses a backwards range and a zero-length suffix', () => {
    expect(parseByteRange('bytes=300-200', SIZE)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable')
  })

  it('refuses any range on an empty file', () => {
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-10', 0)).toBe('unsatisfiable')
  })

  it('has an answer for a nonsense size', () => {
    expect(parseByteRange('bytes=0-99', Number.NaN)).toBeNull()
    expect(parseByteRange('bytes=0-99', -1)).toBeNull()
  })

  it('never runs past the end of the file, whatever it is asked', () => {
    for (const header of ['bytes=0-', 'bytes=-5000', 'bytes=999-1500', 'bytes=0-99999']) {
      const range = parseByteRange(header, SIZE)
      expect(range).not.toBe('unsatisfiable')
      if (range && range !== 'unsatisfiable') {
        expect(range.start).toBeGreaterThanOrEqual(0)
        expect(range.end).toBeLessThan(SIZE)
        expect(range.end).toBeGreaterThanOrEqual(range.start)
      }
    }
  })
})

describe('contentRange', () => {
  it('names the slice and the whole', () => {
    expect(contentRange({ start: 0, end: 99 }, 1000)).toBe('bytes 0-99/1000')
    expect(contentRange({ start: 999, end: 999 }, 1000)).toBe('bytes 999-999/1000')
  })
})
