import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEXT_EXTENSIONS } from '../src/shared/textFiles'

// The NSIS script can't import TypeScript, so the extension list lives in two
// places. This pins them together: a verb on an extension Quick Note refuses
// would open an error, and a missing one is a silently absent menu entry.
const nsh = fs.readFileSync(path.join(__dirname, '..', 'resources', 'installer.nsh'), 'utf8')

const verbExts = [...nsh.matchAll(/^\s*!insertmacro QuickNoteVerb\$\{ACTION\} (\S+)\s*$/gm)].map((m) => m[1])

describe('installer "Open with Quick Note" verb', () => {
  it('covers exactly TEXT_EXTENSIONS', () => {
    expect([...verbExts].sort()).toEqual([...TEXT_EXTENSIONS].sort())
  })

  it('lists no extension twice', () => {
    expect(new Set(verbExts).size).toBe(verbExts.length)
  })

  it('forces Quick Note and quotes the file path', () => {
    // Without --quicknote a vault note would be routed to Vault by fileRoute.ts,
    // which defeats the point of an explicit "Open with Quick Note".
    expect(nsh).toContain(`'"$INSTDIR\\Lumina.exe" --quicknote "%1"'`)
  })

  it('is installed and uninstalled', () => {
    expect(nsh).toMatch(/!macro customInstall[\s\S]*QuickNoteVerbsForEach Add[\s\S]*!macroend/)
    expect(nsh).toMatch(/!macro customUnInstall[\s\S]*QuickNoteVerbsForEach Remove[\s\S]*!macroend/)
  })
})
