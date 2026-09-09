export interface ThemeColors {
  paper: string
  ink: string
  chrome: string
  titlebar: string
  gutter: string
  gutterInk: string
  tabBg: string
  tabActiveBg: string
  tabAccent: string
  tabInk: string
  selectionBg: string
  caretColor: string
  borderColor: string
}

export interface TypographySettings {
  editorFont: string
  editorSize: number
  editorLineHeight: number
  editorWeight: string
  editorSpacing: number
  tabSize: number
  uiFont: string
  uiSize: number
}

export interface ThemeConfig {
  name: string
  colors: ThemeColors
  typography: TypographySettings
}

export const PRESET_THEMES: Record<string, { name: string; colors: ThemeColors }> = {
  dark: {
    name: 'Dark',
    colors: {
      paper: '#3f3f3f',
      ink: '#e4e4e4',
      chrome: '#202020',
      titlebar: '#101010',
      gutter: '#242424',
      gutterInk: '#a7b4b7',
      tabBg: 'transparent',
      tabActiveBg: '#3f3f3f',
      tabAccent: '#81bbaa',
      tabInk: '#e4e4e4',
      selectionBg: '#264f78',
      caretColor: '#b8d8c9',
      borderColor: '#626262'
    }
  },
  light: {
    name: 'Light',
    colors: {
      paper: '#ffffff',
      ink: '#202020',
      chrome: '#ededed',
      titlebar: '#d6d6d6',
      gutter: '#f3f3f3',
      gutterInk: '#788285',
      tabBg: 'transparent',
      tabActiveBg: '#ffffff',
      tabAccent: '#3878b4',
      tabInk: '#202020',
      selectionBg: '#add6ff',
      caretColor: '#1d5a92',
      borderColor: '#cccccc'
    }
  },
  monokai: {
    name: 'Monokai',
    colors: {
      paper: '#272822',
      ink: '#f8f8f2',
      chrome: '#1e1f1c',
      titlebar: '#141413',
      gutter: '#272822',
      gutterInk: '#75715e',
      tabBg: '#1e1f1c',
      tabActiveBg: '#272822',
      tabAccent: '#a6e22e',
      tabInk: '#f8f8f2',
      selectionBg: '#49483e',
      caretColor: '#f8f8f0',
      borderColor: '#3e3d32'
    }
  },
  dracula: {
    name: 'Dracula',
    colors: {
      paper: '#282a36',
      ink: '#f8f8f2',
      chrome: '#21222c',
      titlebar: '#191a21',
      gutter: '#282a36',
      gutterInk: '#6272a4',
      tabBg: '#21222c',
      tabActiveBg: '#282a36',
      tabAccent: '#bd93f9',
      tabInk: '#f8f8f2',
      selectionBg: '#44475a',
      caretColor: '#ff79c6',
      borderColor: '#44475a'
    }
  },
  nord: {
    name: 'Nord',
    colors: {
      paper: '#2e3440',
      ink: '#d8dee9',
      chrome: '#242933',
      titlebar: '#1d212a',
      gutter: '#2e3440',
      gutterInk: '#4c566a',
      tabBg: '#242933',
      tabActiveBg: '#2e3440',
      tabAccent: '#88c0d0',
      tabInk: '#eceff4',
      selectionBg: '#434c5e',
      caretColor: '#88c0d0',
      borderColor: '#3b4252'
    }
  },
  solarizedDark: {
    name: 'Solarized Dark',
    colors: {
      paper: '#002b36',
      ink: '#839496',
      chrome: '#073642',
      titlebar: '#001e26',
      gutter: '#073642',
      gutterInk: '#586e75',
      tabBg: '#073642',
      tabActiveBg: '#002b36',
      tabAccent: '#2aa198',
      tabInk: '#93a1a1',
      selectionBg: '#073642',
      caretColor: '#268bd2',
      borderColor: '#073642'
    }
  },
  solarizedLight: {
    name: 'Solarized Light',
    colors: {
      paper: '#fdf6e3',
      ink: '#657b83',
      chrome: '#eee8d5',
      titlebar: '#e0dac8',
      gutter: '#eee8d5',
      gutterInk: '#93a1a1',
      tabBg: '#eee8d5',
      tabActiveBg: '#fdf6e3',
      tabAccent: '#268bd2',
      tabInk: '#586e75',
      selectionBg: '#eee8d5',
      caretColor: '#2aa198',
      borderColor: '#d33682'
    }
  },
  cyberpunk: {
    name: 'Cyberpunk',
    colors: {
      paper: '#120422',
      ink: '#00ffcc',
      chrome: '#1b0033',
      titlebar: '#0e001a',
      gutter: '#160029',
      gutterInk: '#ff007f',
      tabBg: '#1b0033',
      tabActiveBg: '#120422',
      tabAccent: '#ff007f',
      tabInk: '#00ffcc',
      selectionBg: '#ff007f55',
      caretColor: '#ffff00',
      borderColor: '#ff007f88'
    }
  }
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  editorFont: 'Consolas, "Courier New", monospace',
  editorSize: 13,
  editorLineHeight: 20,
  editorWeight: '400',
  editorSpacing: 0,
  tabSize: 4,
  uiFont: "'Segoe UI', system-ui, sans-serif",
  uiSize: 12
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  name: 'dark',
  colors: { ...PRESET_THEMES.dark.colors },
  typography: { ...DEFAULT_TYPOGRAPHY }
}
