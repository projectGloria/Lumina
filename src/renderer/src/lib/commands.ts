/**
 * Every action in Lumina, in one registry.
 *
 * The command palette lists this, the hotkey handler dispatches from it, and
 * the settings screen rebinds it. Menus and buttons call the same ids, so
 * there is exactly one definition of what "new note" means. It is also the
 * seam a plugin API would extend, which is why commands are plain data rather
 * than scattered click handlers.
 */
import { copyLineDown } from '@codemirror/commands'
import { dirname } from '@shared/markdown-parse'
import type { IconName } from '../components/Icon'
import {
  closeTab,
  confirmDelete,
  createGeneratedNote,
  createQuickNote,
  isStarred,
  openDailyNote,
  pickVault,
  promptNewFolder,
  promptRename,
  saveNoteWithFeedback,
  toggleStar
} from './actions'
import { renderToHtml } from './render'
import { cancelVoice, isRecording, stopVoice, toggleVoice } from './voice'
import {
  isReading,
  skipReading,
  stopReading,
  togglePauseReading,
  toggleReadAloud
} from './readAloud'
import { getActiveView } from '../editor/activeView'
import {
  insertLink,
  insertWikilink,
  toggleBullet,
  toggleHeading,
  toggleNumbered,
  toggleQuote,
  toggleTask,
  toggleWrap
} from '../editor/format'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { toast, useUi } from '../store/uiStore'
import { titleOf, useVault } from '../store/vaultStore'
import { useHome } from '../store/homeStore'
import { useMusic } from '../store/musicStore'
import { activePath, isHomeActive, useWorkspace } from '../store/workspaceStore'
import { step, togglePlay } from './musicPlayer'

export interface Command {
  id: string
  title: string
  section: 'Navigation' | 'Notes' | 'Editor' | 'View' | 'Vault'
  /** Glyph used anywhere commands are presented alongside notes. */
  icon?: IconName
  /** Extra terms accepted by the unified navigator. */
  keywords?: string[]
  /** Short explanation shown by command and slash-command surfaces. */
  description?: string
  /** Default accelerator; the user can override it in settings. */
  hotkey?: string
  /** Hidden from the palette and ignored by hotkeys when this returns false. */
  enabled?: () => boolean
  run: () => void
}

const hasNote = (): boolean => activePath() !== null
const withView = (fn: (view: NonNullable<ReturnType<typeof getActiveView>>) => void) => (): void => {
  const view = getActiveView()
  if (view) fn(view)
}

export const COMMANDS: Command[] = [
  /* ------------------------------------------------------- navigation */
  {
    id: 'switcher.open',
    title: 'Go to note',
    section: 'Navigation',
    icon: 'search',
    hotkey: 'Ctrl+P',
    run: () => useUi.getState().openModal('switcher')
  },
  {
    id: 'palette.open',
    title: 'Command palette',
    section: 'Navigation',
    icon: 'keyboard',
    hotkey: 'Ctrl+Shift+P',
    run: () => useUi.getState().openModal('palette')
  },
  {
    id: 'search.open',
    title: 'Search in all notes',
    section: 'Navigation',
    icon: 'search',
    hotkey: 'Ctrl+Shift+F',
    run: () => useWorkspace.getState().setLeftPanel('search')
  },
  {
    id: 'graph.open',
    title: 'Open graph view',
    section: 'Navigation',
    icon: 'graph',
    hotkey: 'Ctrl+G',
    run: () => useUi.getState().openModal('graph')
  },
  {
    id: 'nav.back',
    title: 'Navigate back',
    section: 'Navigation',
    icon: 'back',
    hotkey: 'Alt+Left',
    run: () => useWorkspace.getState().back()
  },
  {
    id: 'nav.forward',
    title: 'Navigate forward',
    section: 'Navigation',
    icon: 'forward',
    hotkey: 'Alt+Right',
    run: () => useWorkspace.getState().forward()
  },
  {
    id: 'tab.next',
    title: 'Next tab',
    section: 'Navigation',
    icon: 'files',
    hotkey: 'Ctrl+Tab',
    run: () => useWorkspace.getState().nextTab(1)
  },
  {
    id: 'tab.prev',
    title: 'Previous tab',
    section: 'Navigation',
    icon: 'files',
    hotkey: 'Ctrl+Shift+Tab',
    run: () => useWorkspace.getState().nextTab(-1)
  },
  {
    id: 'tab.close',
    title: 'Close tab',
    section: 'Navigation',
    icon: 'close',
    hotkey: 'Ctrl+W',
    enabled: hasNote,
    run: () => void closeTab(useWorkspace.getState().activeTab)
  },

  /* ------------------------------------------------------------ notes */
  {
    id: 'note.new',
    title: 'New note',
    section: 'Notes',
    icon: 'plus',
    hotkey: 'Ctrl+N',
    run: () => {
      const current = activePath()
      void createGeneratedNote(current ? dirname(current) : '')
    }
  },
  {
    id: 'note.quick',
    title: 'New quick note',
    section: 'Notes',
    icon: 'bolt',
    // The same note the OS-wide shortcut makes, for when Lumina already has
    // focus and reaching for a global accelerator would be silly.
    run: () => void createQuickNote()
  },
  {
    id: 'note.newFolder',
    title: 'New folder',
    section: 'Notes',
    icon: 'folderPlus',
    run: () => promptNewFolder('')
  },
  {
    id: 'note.daily',
    title: "Open today's daily note",
    section: 'Notes',
    icon: 'clock',
    hotkey: 'Ctrl+Alt+D',
    run: () => void openDailyNote()
  },
  {
    id: 'note.save',
    title: 'Save note',
    section: 'Notes',
    icon: 'check',
    hotkey: 'Ctrl+S',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (!path) return
      void saveNoteWithFeedback(path)
    }
  },
  {
    id: 'note.rename',
    title: 'Rename note',
    section: 'Notes',
    icon: 'edit',
    hotkey: 'F2',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (path) promptRename(path)
    }
  },
  {
    id: 'note.delete',
    title: 'Delete note',
    section: 'Notes',
    icon: 'trash',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (path) confirmDelete(path)
    }
  },
  {
    id: 'note.star',
    title: 'Star or unstar this note',
    section: 'Notes',
    icon: 'star',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (!path) return
      const was = isStarred(path)
      toggleStar(path)
      toast(was ? 'Removed from starred' : 'Added to starred')
    }
  },
  {
    id: 'note.copyLink',
    title: 'Copy link to this note',
    section: 'Notes',
    icon: 'link',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (!path) return
      void navigator.clipboard.writeText(`[[${titleOf(path)}]]`)
      toast('Link copied')
    }
  },
  {
    id: 'note.reveal',
    title: 'Show in file explorer',
    section: 'Notes',
    icon: 'folder',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (path) void window.lumina.vault.reveal(path)
    }
  },
  {
    id: 'note.exportHtml',
    title: 'Export note as HTML',
    section: 'Notes',
    icon: 'download',
    enabled: hasNote,
    run: () => void exportNote('html')
  },
  {
    id: 'note.exportPdf',
    title: 'Export note as PDF',
    section: 'Notes',
    icon: 'download',
    enabled: hasNote,
    run: () => void exportNote('pdf')
  },

  /* ----------------------------------------------------------- editor */
  { id: 'format.bold', title: 'Bold', section: 'Editor', icon: 'book', description: 'Wrap the selection in bold markers', hotkey: 'Ctrl+B', enabled: hasNote, run: withView((v) => toggleWrap(v, '**')) },
  { id: 'format.italic', title: 'Italic', section: 'Editor', icon: 'edit', description: 'Wrap the selection in italic markers', hotkey: 'Ctrl+I', enabled: hasNote, run: withView((v) => toggleWrap(v, '*')) },
  { id: 'format.code', title: 'Inline code', section: 'Editor', icon: 'slash', description: 'Format the selection as inline code', enabled: hasNote, run: withView((v) => toggleWrap(v, '`')) },
  { id: 'format.highlight', title: 'Highlight', section: 'Editor', icon: 'palette', description: 'Highlight the selected text', enabled: hasNote, run: withView((v) => toggleWrap(v, '==')) },
  { id: 'format.strike', title: 'Strikethrough', section: 'Editor', icon: 'edit', description: 'Strike through the selected text', enabled: hasNote, run: withView((v) => toggleWrap(v, '~~')) },
  { id: 'format.link', title: 'Insert link', section: 'Editor', icon: 'link', description: 'Insert or edit a web link', hotkey: 'Ctrl+K', enabled: hasNote, run: withView(insertLink) },
  { id: 'format.wikilink', title: 'Insert wikilink', section: 'Editor', icon: 'link', description: 'Link to another note in the vault', enabled: hasNote, run: withView(insertWikilink) },
  { id: 'format.task', title: 'Toggle task', section: 'Editor', icon: 'check', description: 'Turn the current line into a task', hotkey: 'Ctrl+Enter', enabled: hasNote, run: withView(toggleTask) },
  { id: 'format.quote', title: 'Toggle quote', section: 'Editor', icon: 'info', description: 'Turn the current line into a quote', enabled: hasNote, run: withView(toggleQuote) },
  { id: 'format.bullet', title: 'Toggle bullet list', section: 'Editor', icon: 'outline', description: 'Turn the current line into a bullet', enabled: hasNote, run: withView(toggleBullet) },
  { id: 'format.numbered', title: 'Toggle numbered list', section: 'Editor', icon: 'outline', description: 'Turn the current line into a numbered item', enabled: hasNote, run: withView(toggleNumbered) },
  { id: 'format.h1', title: 'Heading 1', section: 'Editor', icon: 'hash', description: 'Make the current line a large heading', enabled: hasNote, run: withView((v) => toggleHeading(v, 1)) },
  { id: 'format.h2', title: 'Heading 2', section: 'Editor', icon: 'hash', description: 'Make the current line a medium heading', enabled: hasNote, run: withView((v) => toggleHeading(v, 2)) },
  { id: 'format.h3', title: 'Heading 3', section: 'Editor', icon: 'hash', description: 'Make the current line a small heading', enabled: hasNote, run: withView((v) => toggleHeading(v, 3)) },
  {
    id: 'editor.duplicateLine',
    title: 'Duplicate line',
    section: 'Editor',
    icon: 'files',
    hotkey: 'Ctrl+D',
    enabled: hasNote,
    run: withView((v) => {
      copyLineDown(v)
    })
  },

  /* ------------------------------------------------------------ voice */
  {
    id: 'voice.record',
    title: 'Record voice note',
    section: 'Editor',
    icon: 'mic',
    keywords: ['audio', 'microphone', 'dictate', 'memo'],
    description: 'Record audio into the vault and embed a player in this note',
    hotkey: 'Ctrl+Shift+R',
    // Toggling means one hotkey both starts and finishes, which is what a hand
    // already holding the keyboard wants; the bar's Done button does the same.
    enabled: hasNote,
    run: () => toggleVoice('note')
  },
  {
    id: 'voice.dictate',
    title: 'Dictate text',
    section: 'Editor',
    icon: 'waveform',
    keywords: ['speech', 'transcribe', 'voice', 'microphone'],
    description: 'Speak, and insert the transcript at the caret without saving audio',
    hotkey: 'Ctrl+Shift+D',
    enabled: hasNote,
    run: () => toggleVoice('dictate')
  },
  {
    id: 'voice.stop',
    title: 'Finish recording',
    section: 'Editor',
    icon: 'stop',
    description: 'Stop the running recording and insert the result',
    enabled: isRecording,
    run: () => void stopVoice()
  },
  {
    id: 'voice.cancel',
    title: 'Discard recording',
    section: 'Editor',
    icon: 'micOff',
    description: 'Throw away the running recording',
    enabled: isRecording,
    run: cancelVoice
  },

  /* -------------------------------------------------------- read aloud */
  {
    id: 'voice.read',
    title: 'Read aloud',
    section: 'Editor',
    icon: 'speaker',
    keywords: ['speak', 'listen', 'tts', 'text to speech', 'voice', 'narrate'],
    description: 'Speak the selected text, or the whole note when nothing is selected',
    hotkey: 'Ctrl+Shift+L',
    // Toggling, like recording: the same key that started the reading stops it,
    // which is what a hand already on the keyboard reaches for.
    run: toggleReadAloud
  },
  {
    id: 'voice.readPause',
    title: 'Pause or resume reading',
    section: 'Editor',
    icon: 'pause',
    keywords: ['speak', 'listen', 'tts'],
    description: 'Hold the reading where it is, and pick it up again',
    enabled: isReading,
    run: togglePauseReading
  },
  {
    id: 'voice.readNext',
    title: 'Skip to the next sentence',
    section: 'Editor',
    icon: 'skipForward',
    keywords: ['speak', 'listen', 'tts'],
    enabled: isReading,
    run: () => skipReading(1)
  },
  {
    id: 'voice.readPrev',
    title: 'Back to the previous sentence',
    section: 'Editor',
    icon: 'skipBack',
    keywords: ['speak', 'listen', 'tts'],
    enabled: isReading,
    run: () => skipReading(-1)
  },
  {
    id: 'voice.readStop',
    title: 'Stop reading aloud',
    section: 'Editor',
    icon: 'stop',
    keywords: ['speak', 'listen', 'tts', 'silence'],
    description: 'Stop speaking and dismiss the player',
    enabled: isReading,
    run: stopReading
  },

  /* ------------------------------------------------------------- view */
  {
    id: 'view.home',
    title: 'Open Home',
    section: 'View',
    icon: 'home',
    keywords: ['dashboard', 'widgets', 'board', 'start'],
    description: 'Show the dashboard of widgets for this vault',
    hotkey: 'Ctrl+Shift+H',
    run: () => useWorkspace.getState().openHome()
  },
  {
    id: 'home.editLayout',
    title: 'Edit Home layout',
    section: 'View',
    icon: 'grid',
    keywords: ['widgets', 'dashboard', 'arrange', 'board'],
    description: 'Move, resize, add and remove the widgets on Home',
    run: () => {
      // Reachable from anywhere: from Home it toggles, from a note it takes
      // you there and puts the board straight into edit mode.
      const wasHome = isHomeActive()
      useWorkspace.getState().openHome()
      const home = useHome.getState()
      home.setEditing(wasHome ? !home.editing : true)
    }
  },
  /* ------------------------------------------------------------- music */
  // In the registry like everything else, so they are in the palette and can
  // be rebound. No OS-level media keys are registered: those belong to
  // whatever the user considers their music player, which may not be this.
  {
    id: 'music.playPause',
    title: 'Play or pause music',
    section: 'View',
    icon: 'play',
    keywords: ['music', 'player', 'audio', 'song', 'track'],
    run: () => togglePlay()
  },
  {
    id: 'music.next',
    title: 'Next track',
    section: 'View',
    icon: 'skipForward',
    keywords: ['music', 'player', 'skip', 'forward'],
    run: () => step('next')
  },
  {
    id: 'music.previous',
    title: 'Previous track',
    section: 'View',
    icon: 'skipBack',
    keywords: ['music', 'player', 'back'],
    run: () => step('prev')
  },
  {
    id: 'music.toggle',
    title: 'Show the music player',
    section: 'View',
    icon: 'speaker',
    keywords: ['music', 'player', 'library', 'queue'],
    description: 'The queue, the library, and what is playing',
    run: () => {
      const music = useMusic.getState()
      music.setExpanded(!music.expanded)
    }
  },
  {
    id: 'settings.open',
    title: 'Open settings',
    section: 'View',
    icon: 'settings',
    hotkey: 'Ctrl+,',
    run: () => useUi.getState().openSettings()
  },
  {
    id: 'view.toggleLeft',
    title: 'Toggle left sidebar',
    section: 'View',
    icon: 'panelLeft',
    hotkey: 'Ctrl+\\',
    run: () => useWorkspace.getState().toggleLeft()
  },
  {
    id: 'view.toggleRight',
    title: 'Toggle right sidebar',
    section: 'View',
    icon: 'panelRight',
    hotkey: 'Ctrl+Shift+\\',
    run: () => useWorkspace.getState().toggleRight()
  },
  {
    id: 'view.focusMode',
    title: 'Toggle focus mode',
    section: 'View',
    icon: 'focus',
    keywords: ['fullscreen', 'full screen', 'zen', 'distraction free'],
    hotkey: 'Ctrl+Shift+M',
    run: () => useWorkspace.getState().toggleFocusMode()
  },
  {
    id: 'view.toggleTheme',
    title: 'Toggle light and dark',
    section: 'View',
    icon: 'palette',
    keywords: ['theme', 'appearance'],
    run: () => {
      const { settings, patch, mode } = useSettings.getState()
      // From `system`, the first toggle commits to the opposite of what shows.
      const next = settings.themeMode === 'system' ? (mode === 'dark' ? 'light' : 'dark') : mode === 'dark' ? 'light' : 'dark'
      patch({ themeMode: next })
    }
  },
  {
    id: 'view.splitRight',
    title: 'Open note in split view',
    section: 'View',
    icon: 'panelRight',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (path) useWorkspace.getState().openSplit(path)
    }
  },
  {
    id: 'view.closeSplit',
    title: 'Close split view',
    section: 'View',
    icon: 'close',
    enabled: () => useWorkspace.getState().splitPath !== null,
    run: () => useWorkspace.getState().closeSplit()
  },
  {
    id: 'view.readMode',
    title: 'Toggle edit / read mode',
    section: 'View',
    icon: 'book',
    hotkey: 'Ctrl+Shift+E',
    enabled: hasNote,
    // Per tab, so two notes can be open in different modes.
    run: () => useWorkspace.getState().toggleTabMode()
  },
  {
    id: 'view.livePreview',
    title: 'Toggle live preview',
    section: 'View',
    icon: 'edit',
    run: () => {
      const on = useSettings.getState().settings.editor.livePreview
      useSettings.getState().patch({ editor: { livePreview: !on } })
      toast(on ? 'Live preview off, showing raw markdown' : 'Live preview on')
    }
  },
  {
    id: 'view.wordCount',
    title: 'Toggle word count',
    section: 'View',
    icon: 'info',
    run: () => {
      const on = useSettings.getState().settings.editor.showWordCount
      useSettings.getState().patch({ editor: { showWordCount: !on } })
    }
  },
  { id: 'panel.files', title: 'Show file list', section: 'View', icon: 'files', run: () => useWorkspace.getState().setLeftPanel('files') },
  { id: 'panel.tags', title: 'Show tags', section: 'View', icon: 'tag', run: () => useWorkspace.getState().setLeftPanel('tags') },
  { id: 'panel.starred', title: 'Show starred notes', section: 'View', icon: 'star', run: () => useWorkspace.getState().setLeftPanel('starred') },
  { id: 'panel.backlinks', title: 'Show backlinks', section: 'View', icon: 'link', run: () => useWorkspace.getState().setRightPanel('backlinks') },
  { id: 'panel.outline', title: 'Show outline', section: 'View', icon: 'outline', run: () => useWorkspace.getState().setRightPanel('outline') },
  { id: 'panel.localGraph', title: 'Show local graph', section: 'View', icon: 'graph', run: () => useWorkspace.getState().setRightPanel('graph') },

  /* ------------------------------------------------------------ vault */
  {
    id: 'vault.open',
    title: 'Open another vault',
    section: 'Vault',
    icon: 'vault',
    run: () => void pickVault()
  },
  {
    id: 'vault.saveAll',
    title: 'Save all notes',
    section: 'Vault',
    icon: 'check',
    run: () => void useEditor.getState().saveAll()
  },
  {
    id: 'snippets.open',
    title: 'Open CSS snippets folder',
    section: 'Vault',
    icon: 'folder',
    run: () => void window.lumina.snippets.openFolder()
  },
  {
    id: 'vault.stats',
    title: 'Vault statistics',
    section: 'Vault',
    icon: 'info',
    run: () => {
      const { notes, tags } = useVault.getState().index
      const list = Object.values(notes)
      const words = list.reduce((sum, n) => sum + n.wordCount, 0)
      const links = list.reduce((sum, n) => sum + n.links.length, 0)
      toast(
        `${list.length} notes · ${words.toLocaleString()} words · ${links} links · ${Object.keys(tags).length} tags`
      )
    }
  }
]

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

export function getCommand(id: string): Command | undefined {
  return BY_ID.get(id)
}

export function runCommand(id: string): void {
  const command = BY_ID.get(id)
  if (!command) return
  if (command.enabled && !command.enabled()) return
  command.run()
}

/** The accelerator in force for a command, user override included. */
export function hotkeyFor(command: Command): string {
  const override = useSettings.getState().settings.hotkeys[command.id]
  return override ?? command.hotkey ?? ''
}

/** Reactive counterpart of `hotkeyFor`, for labels and tooltips in React. */
export function useCommandHotkey(id: string): string {
  const command = BY_ID.get(id)
  const override = useSettings((s) => s.settings.hotkeys[id])
  return override ?? command?.hotkey ?? ''
}

export function commandTooltip(label: string, hotkey: string): string {
  return hotkey ? `${label}  (${hotkey})` : label
}

async function exportNote(kind: 'html' | 'pdf'): Promise<void> {
  const path = activePath()
  if (!path) return
  const buffer = useEditor.getState().buffers[path]
  if (!buffer) return

  const html = renderToHtml(buffer.content, path)
  const title = titleOf(path)
  try {
    const res =
      kind === 'html'
        ? await window.lumina.files.exportHtml(title, html)
        : await window.lumina.files.exportPdf(title, html)

    if (res.ok) toast(`Exported ${title}`)
    else if (res.error) toast(res.error, 'error')
  } catch (err) {
    toast(`Could not export ${title}: ${(err as Error).message}`, 'error')
  }
}
