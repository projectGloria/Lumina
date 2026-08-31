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
import {
  closeTab,
  confirmDelete,
  createNote,
  isStarred,
  openDailyNote,
  pickVault,
  promptNewFolder,
  promptRename,
  toggleStar
} from './actions'
import { renderToHtml } from './render'
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
import { activePath, useWorkspace } from '../store/workspaceStore'

export interface Command {
  id: string
  title: string
  section: 'Navigation' | 'Notes' | 'Editor' | 'View' | 'Vault'
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
    hotkey: 'Ctrl+P',
    run: () => useUi.getState().openModal('switcher')
  },
  {
    id: 'palette.open',
    title: 'Command palette',
    section: 'Navigation',
    hotkey: 'Ctrl+Shift+P',
    run: () => useUi.getState().openModal('palette')
  },
  {
    id: 'search.open',
    title: 'Search in all notes',
    section: 'Navigation',
    hotkey: 'Ctrl+Shift+F',
    run: () => useWorkspace.getState().setLeftPanel('search')
  },
  {
    id: 'graph.open',
    title: 'Open graph view',
    section: 'Navigation',
    hotkey: 'Ctrl+G',
    run: () => useUi.getState().openModal('graph')
  },
  {
    id: 'nav.back',
    title: 'Navigate back',
    section: 'Navigation',
    hotkey: 'Alt+Left',
    run: () => useWorkspace.getState().back()
  },
  {
    id: 'nav.forward',
    title: 'Navigate forward',
    section: 'Navigation',
    hotkey: 'Alt+Right',
    run: () => useWorkspace.getState().forward()
  },
  {
    id: 'tab.next',
    title: 'Next tab',
    section: 'Navigation',
    hotkey: 'Ctrl+Tab',
    run: () => useWorkspace.getState().nextTab(1)
  },
  {
    id: 'tab.prev',
    title: 'Previous tab',
    section: 'Navigation',
    hotkey: 'Ctrl+Shift+Tab',
    run: () => useWorkspace.getState().nextTab(-1)
  },
  {
    id: 'tab.close',
    title: 'Close tab',
    section: 'Navigation',
    hotkey: 'Ctrl+W',
    enabled: hasNote,
    run: () => void closeTab(useWorkspace.getState().activeTab)
  },

  /* ------------------------------------------------------------ notes */
  {
    id: 'note.new',
    title: 'New note',
    section: 'Notes',
    hotkey: 'Ctrl+N',
    run: () => {
      const current = activePath()
      void createNote(current ? dirname(current) : '', 'Untitled', '')
    }
  },
  {
    id: 'note.newFolder',
    title: 'New folder',
    section: 'Notes',
    run: () => promptNewFolder('')
  },
  {
    id: 'note.daily',
    title: "Open today's daily note",
    section: 'Notes',
    hotkey: 'Ctrl+Alt+D',
    run: () => void openDailyNote()
  },
  {
    id: 'note.save',
    title: 'Save note',
    section: 'Notes',
    hotkey: 'Ctrl+S',
    enabled: hasNote,
    run: () => {
      const path = activePath()
      if (path) void useEditor.getState().save(path)
    }
  },
  {
    id: 'note.rename',
    title: 'Rename note',
    section: 'Notes',
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
    enabled: hasNote,
    run: () => void exportNote('html')
  },
  {
    id: 'note.exportPdf',
    title: 'Export note as PDF',
    section: 'Notes',
    enabled: hasNote,
    run: () => void exportNote('pdf')
  },

  /* ----------------------------------------------------------- editor */
  { id: 'format.bold', title: 'Bold', section: 'Editor', hotkey: 'Ctrl+B', enabled: hasNote, run: withView((v) => toggleWrap(v, '**')) },
  { id: 'format.italic', title: 'Italic', section: 'Editor', hotkey: 'Ctrl+I', enabled: hasNote, run: withView((v) => toggleWrap(v, '*')) },
  { id: 'format.code', title: 'Inline code', section: 'Editor', enabled: hasNote, run: withView((v) => toggleWrap(v, '`')) },
  { id: 'format.highlight', title: 'Highlight', section: 'Editor', enabled: hasNote, run: withView((v) => toggleWrap(v, '==')) },
  { id: 'format.strike', title: 'Strikethrough', section: 'Editor', enabled: hasNote, run: withView((v) => toggleWrap(v, '~~')) },
  { id: 'format.link', title: 'Insert link', section: 'Editor', hotkey: 'Ctrl+K', enabled: hasNote, run: withView(insertLink) },
  { id: 'format.wikilink', title: 'Insert wikilink', section: 'Editor', enabled: hasNote, run: withView(insertWikilink) },
  { id: 'format.task', title: 'Toggle task', section: 'Editor', hotkey: 'Ctrl+Enter', enabled: hasNote, run: withView(toggleTask) },
  { id: 'format.quote', title: 'Toggle quote', section: 'Editor', enabled: hasNote, run: withView(toggleQuote) },
  { id: 'format.bullet', title: 'Toggle bullet list', section: 'Editor', enabled: hasNote, run: withView(toggleBullet) },
  { id: 'format.numbered', title: 'Toggle numbered list', section: 'Editor', enabled: hasNote, run: withView(toggleNumbered) },
  { id: 'format.h1', title: 'Heading 1', section: 'Editor', enabled: hasNote, run: withView((v) => toggleHeading(v, 1)) },
  { id: 'format.h2', title: 'Heading 2', section: 'Editor', enabled: hasNote, run: withView((v) => toggleHeading(v, 2)) },
  { id: 'format.h3', title: 'Heading 3', section: 'Editor', enabled: hasNote, run: withView((v) => toggleHeading(v, 3)) },
  {
    id: 'editor.duplicateLine',
    title: 'Duplicate line',
    section: 'Editor',
    hotkey: 'Ctrl+D',
    enabled: hasNote,
    run: withView((v) => {
      copyLineDown(v)
    })
  },

  /* ------------------------------------------------------------- view */
  {
    id: 'settings.open',
    title: 'Open settings',
    section: 'View',
    hotkey: 'Ctrl+,',
    run: () => useUi.getState().openSettings()
  },
  {
    id: 'view.toggleLeft',
    title: 'Toggle left sidebar',
    section: 'View',
    hotkey: 'Ctrl+\\',
    run: () => useWorkspace.getState().toggleLeft()
  },
  {
    id: 'view.toggleRight',
    title: 'Toggle right sidebar',
    section: 'View',
    hotkey: 'Ctrl+Shift+\\',
    run: () => useWorkspace.getState().toggleRight()
  },
  {
    id: 'view.focusMode',
    title: 'Toggle focus mode',
    section: 'View',
    hotkey: 'Ctrl+Shift+M',
    run: () => useWorkspace.getState().toggleFocusMode()
  },
  {
    id: 'view.toggleTheme',
    title: 'Toggle light and dark',
    section: 'View',
    run: () => {
      const { settings, patch, mode } = useSettings.getState()
      // From `system`, the first toggle commits to the opposite of what shows.
      const next = settings.themeMode === 'system' ? (mode === 'dark' ? 'light' : 'dark') : mode === 'dark' ? 'light' : 'dark'
      patch({ themeMode: next })
    }
  },
  {
    id: 'view.livePreview',
    title: 'Toggle live preview',
    section: 'View',
    run: () => {
      const on = useSettings.getState().settings.editor.livePreview
      useSettings.getState().patch({ editor: { livePreview: !on } })
      toast(on ? 'Live preview off, showing raw markdown' : 'Live preview on')
    }
  },
  { id: 'panel.files', title: 'Show file list', section: 'View', run: () => useWorkspace.getState().setLeftPanel('files') },
  { id: 'panel.tags', title: 'Show tags', section: 'View', run: () => useWorkspace.getState().setLeftPanel('tags') },
  { id: 'panel.starred', title: 'Show starred notes', section: 'View', run: () => useWorkspace.getState().setLeftPanel('starred') },
  { id: 'panel.backlinks', title: 'Show backlinks', section: 'View', run: () => useWorkspace.getState().setRightPanel('backlinks') },
  { id: 'panel.outline', title: 'Show outline', section: 'View', run: () => useWorkspace.getState().setRightPanel('outline') },
  { id: 'panel.localGraph', title: 'Show local graph', section: 'View', run: () => useWorkspace.getState().setRightPanel('graph') },

  /* ------------------------------------------------------------ vault */
  {
    id: 'vault.open',
    title: 'Open another vault',
    section: 'Vault',
    run: () => void pickVault()
  },
  {
    id: 'vault.saveAll',
    title: 'Save all notes',
    section: 'Vault',
    run: () => void useEditor.getState().saveAll()
  },
  {
    id: 'snippets.open',
    title: 'Open CSS snippets folder',
    section: 'Vault',
    run: () => void window.lumina.snippets.openFolder()
  },
  {
    id: 'vault.stats',
    title: 'Vault statistics',
    section: 'Vault',
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
