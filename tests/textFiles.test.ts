/**
 * The decisions Quick Note makes about a file before it ever reaches a tab.
 *
 * Two of these are silent data-loss bugs when they are wrong rather than
 * visible failures: a CRLF file that loses its endings on save, and a UTF-16
 * file mistaken for binary — or worse, read as UTF-8 and written back as
 * mojibake. Both are covered here in both directions.
 */
import { describe, expect, it } from 'vitest'
import {
  decodeText,
  detectEol,
  encodeText,
  encodingLabel,
  eolLabel,
  extensionOf,
  fromEditorText,
  isTextDocumentPath,
  looksBinary,
  sniffBom,
  toEditorText
} from '../src/shared/textFiles'

describe('recognising a text document by name', () => {
  it('accepts the extensions the installer registers', () => {
    for (const path of ['notes.txt', 'server.js', 'data.JSON', 'style.scss', 'run.ps1', 'a/b/c.md']) {
      expect(isTextDocumentPath(path)).toBe(true)
    }
  })

  it('accepts Windows paths and is case-insensitive about the extension', () => {
    expect(isTextDocumentPath('C:\\Users\\nihil\\Notes\\TODO.TXT')).toBe(true)
    expect(isTextDocumentPath('C:/Users/nihil/a.Yml')).toBe(true)
  })

  it('accepts dotfiles and extensionless names that are text by convention', () => {
    expect(isTextDocumentPath('.gitignore')).toBe(true)
    expect(isTextDocumentPath('/home/me/project/Makefile')).toBe(true)
    expect(isTextDocumentPath('C:\\src\\Dockerfile')).toBe(true)
    expect(isTextDocumentPath('LICENSE')).toBe(true)
  })

  it('refuses documents and binaries it has no business opening', () => {
    for (const path of ['photo.png', 'report.docx', 'app.exe', 'archive.zip', 'song.mp3']) {
      expect(isTextDocumentPath(path)).toBe(false)
    }
  })

  it('treats a leading dot as a name, not an extension', () => {
    // `.gitignore` has no extension — the allowlist of names is what catches
    // it, and reading `gitignore` as an extension here would be wrong.
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
    expect(extensionOf('Makefile')).toBe('')
  })
})

describe('telling text from binary', () => {
  const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

  it('calls a NUL byte binary', () => {
    expect(looksBinary(bytes(0x68, 0x69, 0x00, 0x68))).toBe(true)
  })

  it('does not call UTF-16 binary, despite it being half NUL bytes', () => {
    // A BOM'd UTF-16LE "hi". Without the BOM check first, this is the file
    // every Windows Notepad user would be told is not text.
    expect(looksBinary(bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00))).toBe(false)
  })

  it('accepts ordinary text, tabs and newlines included', () => {
    expect(looksBinary(new TextEncoder().encode('line\tone\r\nline two\n'))).toBe(false)
  })

  it('accepts an empty file', () => {
    expect(looksBinary(bytes())).toBe(false)
  })

  it('calls a run of control characters binary even with no NUL', () => {
    expect(looksBinary(bytes(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x41, 0x42))).toBe(true)
  })
})

describe('encodings', () => {
  it('finds the three byte-order marks and nothing else', () => {
    expect(sniffBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('utf8')
    expect(sniffBom(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe('utf16le')
    expect(sniffBom(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toBe('utf16be')
    expect(sniffBom(new TextEncoder().encode('plain'))).toBe(null)
  })

  it('round-trips UTF-8 with or without a byte-order mark', () => {
    const text = 'héllo — ünicode ✓'
    for (const bom of [true, false]) {
      const decoded = decodeText(encodeText(text, 'utf8', bom))
      expect(decoded.text, `bom=${bom}`).toBe(text)
      expect(decoded.encoding).toBe('utf8')
      expect(decoded.bom).toBe(bom)
    }
  })

  it('round-trips UTF-16 in both byte orders when the mark is there to find', () => {
    const text = 'héllo — ünicode ✓'
    for (const encoding of ['utf16le', 'utf16be'] as const) {
      const decoded = decodeText(encodeText(text, encoding, true))
      expect(decoded.text, encoding).toBe(text)
      expect(decoded.encoding).toBe(encoding)
    }
  })

  it('treats BOM-less UTF-16 as binary rather than decoding it into garbage', () => {
    // There is no mark to go on, so nothing can tell these bytes from any
    // other NUL-riddled file. Refusing is the honest answer — decoding them as
    // UTF-8 would open a tab full of replacement characters and, worse, offer
    // to save that back over the original.
    const bytes = encodeText('héllo', 'utf16le', false)
    expect(sniffBom(bytes)).toBe(null)
    expect(looksBinary(bytes)).toBe(true)
  })

  it('strips a byte-order mark from the text but remembers it', () => {
    const decoded = decodeText(encodeText('a', 'utf8', true))
    expect(decoded.text).toBe('a')
    expect(decoded.bom).toBe(true)
    // The BOM has to come back on write, or a file Windows tools depend on
    // quietly loses it the first time it is saved.
    expect(Array.from(encodeText('a', 'utf8', true).subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('survives a surrogate pair through UTF-16 in both byte orders', () => {
    const rocket = '🚀 go'
    expect(decodeText(encodeText(rocket, 'utf16le', true)).text).toBe(rocket)
    expect(decodeText(encodeText(rocket, 'utf16be', true)).text).toBe(rocket)
  })

  it('reads a file with no BOM as UTF-8', () => {
    const decoded = decodeText(new TextEncoder().encode('no mark here'))
    expect(decoded).toEqual({ text: 'no mark here', encoding: 'utf8', bom: false })
  })

  it('labels what the status bar shows', () => {
    expect(encodingLabel('utf8', false)).toBe('UTF-8')
    expect(encodingLabel('utf8', true)).toBe('UTF-8 BOM')
    expect(encodingLabel('utf16le', true)).toBe('UTF-16 LE')
  })
})

describe('line endings', () => {
  it('detects the ending the file actually uses', () => {
    expect(detectEol('a\r\nb\r\nc')).toBe('crlf')
    expect(detectEol('a\nb\nc')).toBe('lf')
    expect(detectEol('single line')).toBe('lf')
  })

  it('lets the majority win, so one stray ending does not convert the file', () => {
    // A Unix file with one CRLF in it is still a Unix file. Rewriting all of
    // it on the next save is the change nobody asked for.
    expect(detectEol('a\nb\nc\r\nd\ne')).toBe('lf')
    expect(detectEol('a\r\nb\r\nc\nd')).toBe('crlf')
  })

  it('normalises for the editor and restores on the way out', () => {
    const disk = 'one\r\ntwo\r\nthree'
    const inEditor = toEditorText(disk)
    // A textarea reports LF whatever it was given, so the buffer has to hold
    // LF or every CRLF file would look modified the instant it opened.
    expect(inEditor).toBe('one\ntwo\nthree')
    expect(fromEditorText(inEditor, detectEol(disk))).toBe(disk)
  })

  it('folds a classic Mac lone CR so the file is not one huge line', () => {
    expect(toEditorText('a\rb\rc')).toBe('a\nb\nc')
  })

  it('leaves an LF file alone in both directions', () => {
    expect(fromEditorText('a\nb', 'lf')).toBe('a\nb')
    expect(eolLabel('lf')).toBe('LF')
    expect(eolLabel('crlf')).toBe('CRLF')
  })
})
