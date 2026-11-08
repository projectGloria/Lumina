import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEXT_EXTENSIONS } from '../src/shared/textFiles'

// The NSIS script can't import TypeScript, so the extension list lives in two
// places. This pins them together: registering an extension Quick Note refuses
// would open an error, and a missing one is a silently absent "Open with" entry.
const nsh = fs.readFileSync(path.join(__dirname, '..', 'resources', 'installer.nsh'), 'utf8')

const exts = [...nsh.matchAll(/^\s*!insertmacro \$\{PER_EXT\} (\S+)\s*$/gm)].map((m) => m[1])

describe('installer registration of Lumina Quick Note', () => {
  it('covers exactly TEXT_EXTENSIONS', () => {
    expect([...exts].sort()).toEqual([...TEXT_EXTENSIONS].sort())
  })

  it('lists no extension twice', () => {
    expect(new Set(exts).size).toBe(exts.length)
  })

  it('opens files through the launcher exe with the path quoted', () => {
    // Windows lists executables, not flags: pointing at Lumina.exe would merge
    // Quick Note back into "Lumina" in Open with / Default apps.
    expect(nsh).toContain(`!define QUICKNOTE_EXE "Lumina Quick Note.exe"`)
    // Plain string: `${...}` here is NSIS syntax, not a JS interpolation.
    expect(nsh).toContain('\'"$INSTDIR\\${QUICKNOTE_EXE}" "%1"\'')
    expect(nsh).not.toMatch(/Lumina\.exe" --quicknote/)
  })

  it('only offers itself — never writes an extension default', () => {
    // A default value on Software\Classes\.ext would hijack the user's choice.
    expect(nsh).not.toMatch(/WriteRegStr SHCTX "Software\Classes\\.\$\{EXT\}" ""/)
  })

  it('is installed and uninstalled', () => {
    expect(nsh).toMatch(/!macro customInstall[\s\S]*QuickNoteAppAdd[\s\S]*QuickNoteExtsForEach QuickNoteExtAdd[\s\S]*!macroend/)
    expect(nsh).toMatch(/!macro customUnInstall[\s\S]*QuickNoteExtsForEach QuickNoteExtRemove[\s\S]*QuickNoteAppRemove[\s\S]*!macroend/)
  })
})
