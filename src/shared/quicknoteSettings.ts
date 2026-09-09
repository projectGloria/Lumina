import type { ThemeConfig } from './quicknoteTheme'

export interface FullQuickNoteSettings {
  version: 1
  app: 'Lumina Quick Note'
  exportedAt: number
  theme: ThemeConfig
  shortcuts: Record<string, string>
}

export function serializeSettingsPayload(theme: ThemeConfig, shortcuts: Record<string, string>): string {
  const payload: FullQuickNoteSettings = {
    version: 1,
    app: 'Lumina Quick Note',
    exportedAt: Date.now(),
    theme,
    shortcuts
  }
  return JSON.stringify(payload, null, 2)
}

export function parseSettingsPayload(jsonStr: string): { success: boolean; data?: FullQuickNoteSettings; message: string } {
  try {
    const data = JSON.parse(jsonStr) as Partial<FullQuickNoteSettings>
    if (!data || typeof data !== 'object') {
      return { success: false, message: 'Invalid settings file: not a JSON object.' }
    }
    if (data.version !== 1) {
      return { success: false, message: 'Unsupported settings file version.' }
    }
    if (!data.theme || typeof data.theme !== 'object' || !data.theme.colors || !data.theme.typography) {
      return { success: false, message: 'Invalid settings file: missing theme data.' }
    }
    if (!data.shortcuts || typeof data.shortcuts !== 'object') {
      return { success: false, message: 'Invalid settings file: missing shortcuts data.' }
    }
    return { success: true, data: data as FullQuickNoteSettings, message: 'Settings parsed successfully.' }
  } catch (err) {
    return { success: false, message: `Failed to parse settings: ${String(err)}` }
  }
}
