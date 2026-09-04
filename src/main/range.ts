/**
 * The `Range` header, for serving audio out of the `lumina://` handler.
 *
 * An `<img>` asks for a whole file once. An `<audio>` element does not: it
 * seeks by asking for a byte range, and a handler that always answers from byte
 * zero either re-reads the whole file on every drag of the scrubber or refuses
 * to seek at all. On a four-minute MP3 nobody notices; on an hour of FLAC it is
 * the difference between a player and a toy.
 *
 * Kept free of `electron` so `tests/range.test.ts` can exercise it, the same
 * reason `openFile.ts` and `transcribe.ts` are.
 */

export interface ByteRange {
  /** First byte to send, inclusive. */
  start: number
  /** Last byte to send, inclusive — never past the end of the file. */
  end: number
}

/**
 * What a `Range` header is asking for, or null to send the whole file.
 *
 * Null covers every case where a normal 200 is the right answer: no header, a
 * unit that is not bytes, a multi-range request (legal to answer whole), and
 * anything malformed. `'unsatisfiable'` is different and has to stay
 * distinguishable — a range that starts past the end of the file is a 416, and
 * answering it with the whole file would hand a media element bytes it did not
 * ask for and cannot place.
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number
): ByteRange | 'unsatisfiable' | null {
  if (!header || !Number.isFinite(size) || size < 0) return null

  const value = header.trim()
  if (!value.toLowerCase().startsWith('bytes=')) return null

  const spec = value.slice('bytes='.length).trim()
  // A multi-range request may be answered with the whole representation, which
  // is a great deal simpler than assembling a multipart body no media element
  // is going to send for anyway.
  if (spec.includes(',')) return null

  const dash = spec.indexOf('-')
  if (dash < 0) return null
  const rawStart = spec.slice(0, dash).trim()
  const rawEnd = spec.slice(dash + 1).trim()

  // `bytes=-500` is the *last* 500 bytes, not "up to byte 500". Getting this
  // backwards would serve the opening of a file to something asking for its
  // end, which for a seekable stream is a silent wrong answer.
  if (!rawStart) {
    if (!/^\d+$/.test(rawEnd)) return null
    const wanted = Number(rawEnd)
    if (wanted === 0) return 'unsatisfiable'
    if (size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - wanted), end: size - 1 }
  }

  if (!/^\d+$/.test(rawStart)) return null
  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'

  // `bytes=1000-` is "from here to the end", which is what a player sends when
  // it starts streaming from a seek point.
  if (!rawEnd) return { start, end: size - 1 }
  if (!/^\d+$/.test(rawEnd)) return null

  const end = Math.min(Number(rawEnd), size - 1)
  if (end < start) return 'unsatisfiable'
  return { start, end }
}

/** The `Content-Range` a 206 must carry, so the client can place the bytes. */
export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`
}
