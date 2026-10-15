/**
 * What Quick Note is willing to open, and how to read and write it unharmed.
 *
 * Quick Note became the editor the operating system hands files to, which puts
 * three questions on the boot path that the draft-scratchpad version never had
 * to answer: is this thing text at all, what encoding is it in, and what line
 * ending does it use. Getting the last two wrong is not a cosmetic failure —
 * a `<textarea>` normalises every CRLF it is given to a bare LF, so opening a
 * Windows file and pressing Ctrl+S would silently rewrite every line in it.
 * The file's own ending is therefore detected on read and restored on write,
 * and the same is done for a byte-order mark.
 *
 * Everything here is pure and free of any `node:` import — `TextDecoder` and
 * `Uint8Array` exist on both sides — so `tests/textFiles.test.ts` can cover the
 * decisions without an Electron process, and the renderer can label a status
 * bar from the same functions the main process wrote the file with.
 */

/**
 * Extensions Quick Note treats as text on sight.
 *
 * Deliberately a list rather than a guess: an allowlist that says yes to
 * `.json` and nothing about `.docx` is predictable, and the sniffing fallback
 * below covers the long tail. Kept in step with `fileAssociations` in
 * `electron-builder.yml` — the installer is what makes these double-clickable,
 * and a type registered there that this refuses would open an error instead of
 * a file.
 */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  // plain text and logs
  'txt', 'text', 'log', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'tex',
  // configuration
  'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'toml', 'editorconfig',
  // data and interchange
  'json', 'json5', 'jsonc', 'yaml', 'yml', 'xml', 'csv', 'tsv', 'plist', 'svg',
  // web
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  // scripting and source
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
  'py', 'pyw', 'rb', 'go', 'rs', 'lua', 'pl', 'php', 'r',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'java', 'kt', 'kts',
  'swift', 'scala', 'dart', 'sql', 'graphql', 'gql', 'proto',
  // shells and batch
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  // build and packaging
  'gradle', 'cmake', 'mk', 'make', 'dockerfile', 'gitignore', 'gitattributes',
  'patch', 'diff'
])

/**
 * Files that are text despite having no extension to go on.
 *
 * `path.extname('.gitignore')` is the empty string — a leading dot names the
 * file, it does not introduce an extension — so every dotfile would fall
 * through to sniffing without this. Compared case-insensitively, because
 * `Makefile` and `makefile` are equally common.
 */
export const TEXT_FILENAMES: ReadonlySet<string> = new Set([
  'makefile', 'dockerfile', 'containerfile', 'jenkinsfile', 'vagrantfile',
  'procfile', 'rakefile', 'gemfile', 'brewfile', 'cmakelists.txt',
  'license', 'licence', 'readme', 'changelog', 'authors', 'contributors',
  'notice', 'copying', 'install', 'news', 'todo', 'version',
  '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.npmignore',
  '.npmrc', '.nvmrc', '.env', '.editorconfig', '.prettierrc', '.babelrc',
  '.eslintrc', '.bashrc', '.zshrc', '.profile', '.vimrc', '.htaccess'
])

/** Last path segment, for either separator — this runs on Windows paths too. */
export function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  return slash === -1 ? normalized : normalized.slice(slash + 1)
}

/** The part after the last dot, lowercased, or '' when there is none. */
export function extensionOf(filePath: string): string {
  const name = baseName(filePath)
  const dot = name.lastIndexOf('.')
  // `<= 0` covers both "no dot" and a leading dot, which names a dotfile
  // rather than giving it an extension.
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Whether the name alone is enough to call this a text document.
 *
 * A `false` here is not a refusal — it means the name told us nothing and the
 * bytes have to be looked at (`looksBinary`). It is only the fast path that
 * keeps a double-clicked `.txt` from being read twice.
 */
export function isTextDocumentPath(filePath: string): boolean {
  const name = baseName(filePath).toLowerCase()
  if (TEXT_FILENAMES.has(name)) return true
  const ext = extensionOf(filePath)
  return ext !== '' && TEXT_EXTENSIONS.has(ext)
}

/** The three byte-order marks worth recognising. */
export type Encoding = 'utf8' | 'utf16le' | 'utf16be'

export interface DecodedText {
  text: string
  encoding: Encoding
  /** Whether the file carried a byte-order mark, so a write can put it back. */
  bom: boolean
}

function hasPrefix(bytes: Uint8Array, ...prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, i) => bytes[i] === byte)
}

/** The encoding a leading byte-order mark declares, if there is one. */
export function sniffBom(bytes: Uint8Array): Encoding | null {
  if (hasPrefix(bytes, 0xef, 0xbb, 0xbf)) return 'utf8'
  if (hasPrefix(bytes, 0xff, 0xfe)) return 'utf16le'
  if (hasPrefix(bytes, 0xfe, 0xff)) return 'utf16be'
  return null
}

/**
 * Whether a sample of the file looks like something no one wants in a textarea.
 *
 * A NUL byte is the usual giveaway, but UTF-16 text is *half* NUL bytes by
 * construction, so a declared UTF-16 BOM has to be checked first or every
 * Notepad "Unicode" file would be turned away as binary. Past that, a high
 * proportion of control characters catches the formats that carry no NULs.
 *
 * Only a prefix is examined; the caller decides how much to read.
 */
export function looksBinary(sample: Uint8Array): boolean {
  if (sniffBom(sample)) return false
  if (sample.length === 0) return false

  let control = 0
  for (const byte of sample) {
    if (byte === 0) return true
    // Tab, newline, carriage return and form feed are expected in text; the
    // rest of C0 and the lone DEL are not.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) control++
  }
  return control / sample.length > 0.3
}

/**
 * Bytes to a string, honouring whatever byte-order mark was found.
 *
 * Without a BOM the bytes are read as UTF-8, which is also the right answer for
 * plain ASCII. A UTF-8 file that is not valid UTF-8 comes back with
 * replacement characters rather than throwing: showing a file with a few
 * mangled glyphs is more useful than refusing to open it, and the encoding is
 * reported so the status bar can say what was assumed.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const declared = sniffBom(bytes)
  const encoding: Encoding = declared ?? 'utf8'
  const skip = declared === 'utf8' ? 3 : declared ? 2 : 0
  const body = skip ? bytes.subarray(skip) : bytes
  const label = encoding === 'utf16be' ? 'utf-16be' : encoding === 'utf16le' ? 'utf-16le' : 'utf-8'
  return { text: new TextDecoder(label).decode(body), encoding, bom: declared !== null }
}

/**
 * A string back to bytes in the encoding it arrived in.
 *
 * `TextEncoder` only emits UTF-8, so the two UTF-16 forms are written by hand.
 * A JavaScript string is already a sequence of UTF-16 code units, which makes
 * this a byte-order choice and nothing more — a surrogate pair is two code
 * units here exactly as it is on disk, so it survives untouched.
 */
export function encodeText(text: string, encoding: Encoding, bom: boolean): Uint8Array {
  if (encoding === 'utf8') {
    const body = new TextEncoder().encode(text)
    if (!bom) return body
    const out = new Uint8Array(body.length + 3)
    out.set([0xef, 0xbb, 0xbf], 0)
    out.set(body, 3)
    return out
  }

  const little = encoding === 'utf16le'
  const offset = bom ? 2 : 0
  const out = new Uint8Array(offset + text.length * 2)
  if (bom) out.set(little ? [0xff, 0xfe] : [0xfe, 0xff], 0)
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    const at = offset + i * 2
    out[at + (little ? 0 : 1)] = unit & 0xff
    out[at + (little ? 1 : 0)] = unit >> 8
  }
  return out
}

export type Eol = 'lf' | 'crlf'

/**
 * The line ending the file is written with.
 *
 * Mixed endings happen, and the majority has to win rather than the first one
 * seen: a Unix file with a single stray CRLF is still a Unix file, and
 * rewriting all of it because of that one line is the change nobody asked for.
 * A file with no line break at all is reported as LF and stays a single line
 * either way.
 */
export function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length
  if (crlf === 0) return 'lf'
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  return crlf >= lf ? 'crlf' : 'lf'
}

/**
 * Disk text to what the editor holds.
 *
 * A `<textarea>` reports its value with LF endings whatever was put into it, so
 * normalising here means the editor's value and the buffer agree — a dirty
 * check comparing them would otherwise report every CRLF file as modified the
 * instant it opened. Lone CRs (classic Mac) are folded in too, since leaving
 * them would show the file as one enormous line.
 */
export function toEditorText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Editor text back to the file's own line ending. */
export function fromEditorText(text: string, eol: Eol): string {
  return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text
}

/** How the status bar spells an encoding. */
export function encodingLabel(encoding: Encoding, bom: boolean): string {
  if (encoding === 'utf16le') return bom ? 'UTF-16 LE' : 'UTF-16 LE (no BOM)'
  if (encoding === 'utf16be') return bom ? 'UTF-16 BE' : 'UTF-16 BE (no BOM)'
  return bom ? 'UTF-8 BOM' : 'UTF-8'
}

/** How the status bar spells a line ending. */
export function eolLabel(eol: Eol): string {
  return eol === 'crlf' ? 'CRLF' : 'LF'
}
