import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

let cachedFonts: string[] | null = null

const STANDARD_FALLBACKS = [
  'Consolas',
  'Cascadia Code',
  'Cascadia Mono',
  'Courier New',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Lucida Console',
  'Segoe UI',
  'Segoe UI Variable',
  'Arial',
  'Calibri',
  'Cambria',
  'Georgia',
  'Tahoma',
  'Trebuchet MS',
  'Verdana'
]

export async function getSystemFonts(): Promise<string[]> {
  if (cachedFonts && cachedFonts.length > 0) return cachedFonts

  const fontNames = new Set<string>()

  if (process.platform === 'win32') {
    const regKeys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
      'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
    ]

    for (const key of regKeys) {
      try {
        const { stdout } = await execAsync(`reg query "${key}"`)
        for (const line of stdout.split('\r\n')) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.includes('REG_SZ')) continue
          const fontNameWithStyle = trimmed.split(/\s+REG_SZ\s+/)[0].trim()
          const cleanName = fontNameWithStyle
            .replace(/\s*\([^\)]*\)$/, '')
            .replace(/\s+(Bold|Italic|Regular|Light|Medium|Black|Semibold|SemiBold|Heavy|Thin|Oblique).*$/i, '')
            .trim()
          if (cleanName && !cleanName.startsWith('@')) {
            fontNames.add(cleanName)
          }
        }
      } catch {}
    }
  } else {
    try {
      const { stdout } = await execAsync('fc-list : family')
      for (const f of stdout.split('\n')) {
        const name = f.split(',')[0].trim()
        if (name && !name.startsWith('@')) fontNames.add(name)
      }
    } catch {}
  }

  for (const fallback of STANDARD_FALLBACKS) {
    fontNames.add(fallback)
  }

  cachedFonts = Array.from(fontNames).sort((a, b) => a.localeCompare(b))
  return cachedFonts
}
