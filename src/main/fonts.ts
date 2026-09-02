import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Return installed family names without adding a native dependency. */
export async function listSystemFonts(): Promise<string[]> {
  const names = new Set<string>()
  try {
    if (process.platform === 'win32') {
      const keys = [
        'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
      ]
      const results = await Promise.allSettled(keys.map((key) => run('reg.exe', ['query', key], { windowsHide: true })))
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        for (const line of result.value.stdout.split(/\r?\n/)) {
          const match = line.trim().match(/^(.*?)\s{2,}REG_\w+\s{2,}/)
          if (!match) continue
          const family = match[1]
            .replace(/\s*\((?:TrueType|OpenType|All res)\)\s*$/i, '')
            .replace(/\s+(?:Regular|Normal)$/i, '')
            .trim()
          if (family) names.add(family)
        }
      }
    } else if (process.platform === 'darwin') {
      const { stdout } = await run('system_profiler', ['SPFontsDataType', '-json'])
      const data = JSON.parse(stdout) as { SPFontsDataType?: { family?: string }[] }
      for (const font of data.SPFontsDataType ?? []) if (font.family) names.add(font.family)
    } else {
      const { stdout } = await run('fc-list', ['--format=%{family}\n'])
      for (const line of stdout.split(/\r?\n/)) {
        for (const family of line.split(',')) if (family.trim()) names.add(family.trim())
      }
    }
  } catch {
    // Typography settings remain editable even if the platform lookup fails.
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}
