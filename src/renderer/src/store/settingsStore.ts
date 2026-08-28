import { create } from 'zustand'
import type { Settings, ThemeFile, TokenOverrides } from '@shared/types'
import type { Snippet } from '../../../preload'

/** Mirrors DEFAULT_SETTINGS in the main process, for first paint before IPC. */
const FALLBACK_SETTINGS: Settings = {
  themeMode: 'system',
  editor: {
    fontSize: 16,
    lineHeight: 1.7,
    editorWidth: 46,
    readableLineLength: true,
    fontFamily: '',
    serifFamily: '',
    monoFamily: '',
    serifHeadings: true,
    spellcheck: true,
    showLineNumbers: false,
    autosaveDelay: 400,
    livePreview: true,
    smartLists: true
  },
  dailyNotes: { folder: 'Daily', format: 'YYYY-MM-DD', template: '' },
  attachmentFolder: 'attachments',
  templateFolder: 'Templates',
  hotkeys: {},
  snippets: {},
  starred: [],
  graphPerformanceMode: false
}

const FALLBACK_THEME: ThemeFile = { preset: 'claude', light: {}, dark: {} }

/**
 * Tokens the theme editor exposes, grouped for the settings UI.
 *
 * Only tokens listed here get a colour picker; the rest still work as snippet
 * targets. Keeping the list explicit stops the editor turning into a wall of
 * every variable in the file.
 */
export const THEME_GROUPS: { label: string; tokens: { name: string; label: string }[] }[] = [
  {
    label: 'Surfaces',
    tokens: [
      { name: 'bg', label: 'Background' },
      { name: 'bg-sidebar', label: 'Sidebar' },
      { name: 'surface', label: 'Cards & popovers' },
      { name: 'surface-hover', label: 'Hover' },
      { name: 'border', label: 'Borders' }
    ]
  },
  {
    label: 'Text',
    tokens: [
      { name: 'text', label: 'Primary' },
      { name: 'text-muted', label: 'Muted' },
      { name: 'text-faint', label: 'Faint' }
    ]
  },
  {
    label: 'Accent',
    tokens: [
      { name: 'accent', label: 'Accent' },
      { name: 'accent-hover', label: 'Accent hover' },
      { name: 'accent-soft', label: 'Accent wash' }
    ]
  },
  {
    label: 'Markdown',
    tokens: [
      { name: 'code-bg', label: 'Code background' },
      { name: 'code-text', label: 'Code text' },
      { name: 'tag-bg', label: 'Tag background' },
      { name: 'mark-bg', label: 'Highlight' },
      { name: 'quote-border', label: 'Quote bar' }
    ]
  }
]

export const PRESETS = [
  { id: 'claude', label: 'Claude' },
  { id: 'contrast', label: 'High contrast' }
]

interface SettingsState {
  settings: Settings
  theme: ThemeFile
  snippets: Snippet[]
  /** `light` or `dark` after resolving the `system` option. */
  mode: 'light' | 'dark'
  ready: boolean

  hydrate: (settings: Settings, theme: ThemeFile, snippets: Snippet[]) => void
  patch: (patch: DeepPartial<Settings>) => void
  setToken: (mode: 'light' | 'dark', token: string, value: string) => void
  clearToken: (mode: 'light' | 'dark', token: string) => void
  resetTheme: () => void
  setPreset: (preset: string) => void
  importTheme: (theme: ThemeFile) => void
  setSnippets: (snippets: Snippet[]) => void
  refreshMode: () => void
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function mergeDeep<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k]
    if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object') {
      out[k] = mergeDeep(b, v as DeepPartial<unknown>)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

const systemDark = (): boolean =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

function resolveMode(settings: Settings): 'light' | 'dark' {
  if (settings.themeMode === 'system') return systemDark() ? 'dark' : 'light'
  return settings.themeMode
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(settings: Settings, theme: ThemeFile): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void window.lumina.settings.set(settings)
    void window.lumina.theme.set(theme)
  }, 250)
}

export const useSettings = create<SettingsState>((set, get) => {
  const commit = (settings: Settings, theme: ThemeFile): void => {
    const mode = resolveMode(settings)
    set({ settings, theme, mode })
    applyTheme(settings, theme, mode, get().snippets)
    persist(settings, theme)
  }

  return {
    settings: FALLBACK_SETTINGS,
    theme: FALLBACK_THEME,
    snippets: [],
    mode: systemDark() ? 'dark' : 'light',
    ready: false,

    hydrate: (settings, theme, snippets) => {
      const mode = resolveMode(settings)
      set({ settings, theme, snippets, mode, ready: true })
      applyTheme(settings, theme, mode, snippets)
    },

    patch: (patch) => {
      const settings = mergeDeep(get().settings, patch)
      commit(settings, get().theme)
    },

    setToken: (mode, token, value) => {
      const theme = { ...get().theme, [mode]: { ...get().theme[mode], [token]: value } }
      commit(get().settings, theme)
    },

    clearToken: (mode, token) => {
      const next: TokenOverrides = { ...get().theme[mode] }
      delete next[token]
      commit(get().settings, { ...get().theme, [mode]: next })
    },

    resetTheme: () => commit(get().settings, { ...get().theme, light: {}, dark: {} }),

    setPreset: (preset) => commit(get().settings, { ...get().theme, preset }),

    importTheme: (theme) => commit(get().settings, theme),

    setSnippets: (snippets) => {
      set({ snippets })
      const { settings, theme, mode } = get()
      applyTheme(settings, theme, mode, snippets)
    },

    refreshMode: () => {
      const { settings, theme, snippets } = get()
      const mode = resolveMode(settings)
      set({ mode })
      applyTheme(settings, theme, mode, snippets)
    }
  }
})

/* ---------------------------------------------------------------- apply */

let snippetStyleEl: HTMLStyleElement | null = null

/**
 * Push the whole appearance state onto the document.
 *
 * Order matters: the stylesheet defines defaults, then editor settings and
 * theme overrides land as inline variables on the root, then user snippets go
 * last in a stylesheet of their own so they can win.
 */
export function applyTheme(
  settings: Settings,
  theme: ThemeFile,
  mode: 'light' | 'dark',
  snippets: Snippet[]
): void {
  const root = document.documentElement

  root.dataset.theme = mode
  root.dataset.preset = theme.preset || 'claude'

  // Clear previously applied inline tokens so removing an override takes effect.
  for (const name of Array.from(root.style)) {
    if (name.startsWith('--lum-')) root.style.removeProperty(name)
  }

  const e = settings.editor
  root.style.setProperty('--lum-font-size', `${e.fontSize}px`)
  root.style.setProperty('--lum-line-height', String(e.lineHeight))
  root.style.setProperty('--lum-editor-width', `${e.editorWidth}rem`)
  // A width the editor can do arithmetic with: `100%` collapses the centring
  // padding to its minimum, which is what "off" should mean here.
  root.style.setProperty(
    '--lum-content-width',
    e.readableLineLength ? `${e.editorWidth}rem` : '100%'
  )
  if (e.fontFamily) root.style.setProperty('--lum-font-editor', e.fontFamily)
  if (e.serifFamily) root.style.setProperty('--lum-font-serif', e.serifFamily)
  if (e.monoFamily) root.style.setProperty('--lum-font-mono', e.monoFamily)
  root.style.setProperty('--lum-font-heading', e.serifHeadings ? 'var(--lum-font-serif)' : 'var(--lum-font-editor)')

  for (const [token, value] of Object.entries(theme[mode] ?? {})) {
    if (value) root.style.setProperty(`--lum-${token}`, value)
  }

  // Snippets, in a single stylesheet appended last.
  if (!snippetStyleEl) {
    snippetStyleEl = document.createElement('style')
    snippetStyleEl.id = 'lumina-snippets'
    document.head.appendChild(snippetStyleEl)
  }
  snippetStyleEl.textContent = snippets
    .filter((s) => settings.snippets[s.name] !== false)
    .map((s) => `/* ${s.name} */\n${s.css}`)
    .join('\n\n')

  syncTitleBar()
}

/** Repaint the native window buttons to match the current theme. */
export function syncTitleBar(): void {
  requestAnimationFrame(() => {
    const style = getComputedStyle(document.documentElement)
    const bg = style.getPropertyValue('--lum-bg-titlebar').trim()
    const symbol = style.getPropertyValue('--lum-text').trim()
    if (bg && symbol) void window.lumina.window.setOverlay(toHex(bg), toHex(symbol))
  })
}

/** The title bar overlay API only accepts `#rrggbb`. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b] = m[1].split(',').map((n) => Math.round(parseFloat(n)))
    const hex = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  return '#faf9f5'
}
