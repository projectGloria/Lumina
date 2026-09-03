import { isNoteTab } from '@shared/types'
import Editor from '../editor/Editor'
import ReadView from '../editor/ReadView'
import Resizer from './Resizer'
import TabBar from './TabBar'
import HomeView from '../home/HomeView'
import { Icon } from './Icon'
import { countWords } from '@shared/markdown-parse'
import { promptNewNote } from '../lib/actions'
import { getCommand, hotkeyFor, runCommand } from '../lib/commands'
import { acceleratorChips } from '../lib/hotkeys'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { titleOf } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

export default function Workspace(): React.JSX.Element {
  const splitPath = useWorkspace((s) => s.splitPath)
  const splitWidth = useWorkspace((s) => s.splitWidth)
  const setSplitWidth = useWorkspace((s) => s.setSplitWidth)

  if (!splitPath) return <PrimaryPane />

  return (
    <div className="split-body">
      <div style={{ width: splitWidth, minWidth: 280, display: 'flex', flexDirection: 'column' }}>
        <PrimaryPane />
      </div>
      <Resizer side="left" width={splitWidth} onResize={setSplitWidth} />
      <SplitPane path={splitPath} />
    </div>
  )
}

function PrimaryPane(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const tab = tabs[activeTab]
  // Home shows no note, so `path` stays undefined for it and everything keyed
  // to a note — the editor, read mode, the word count — stays out of its way.
  const path = tab && isNoteTab(tab) ? tab.path : undefined
  const readMode = (tab?.mode ?? 'edit') === 'read'

  return (
    <main className="pane-main">
      <TabBar />
      {/* No `key`: one editor instance serves every tab, so switching tabs
          swaps state rather than rebuilding and losing the undo history. Kept
          mounted (just hidden) in read mode so its undo history and scroll
          position survive the round trip back to editing. */}
      {tab?.kind === 'home' ? (
        <HomeView />
      ) : path ? (
        <>
          <div style={{ display: readMode ? 'none' : 'contents' }}>
            <Editor path={path} />
          </div>
          {readMode ? <ReadView path={path} /> : null}
        </>
      ) : (
        <NoNoteOpen />
      )}
      {path ? <WordCountBar path={path} /> : null}
    </main>
  )
}

/** The second, split-view pane — a single note, no tabs of its own. */
function SplitPane({ path }: { path: string }): React.JSX.Element {
  const closeSplit = useWorkspace((s) => s.closeSplit)

  return (
    <main className="pane-main split-pane">
      <div className="split-pane-header">
        <span className="split-pane-title truncate">{titleOf(path)}</span>
        <button className="icon-btn" data-tooltip="Close split view" onClick={closeSplit}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <Editor path={path} />
      <WordCountBar path={path} />
    </main>
  )
}

function WordCountBar({ path }: { path: string }): React.JSX.Element | null {
  const show = useSettings((s) => s.settings.editor.showWordCount)
  const content = useEditor((s) => s.buffers[path]?.content)

  if (!show || content === undefined) return null

  const words = countWords(content)
  return (
    <div className="word-count-bar">
      {words} word{words === 1 ? '' : 's'} · {content.length} character{content.length === 1 ? '' : 's'}
    </div>
  )
}

/** What the editor area shows before anything is open. */
function NoNoteOpen(): React.JSX.Element {
  // Keep the shortcut chips live while Settings changes command bindings.
  useSettings((s) => s.settings.hotkeys)
  const shortcuts = [
    { id: 'switcher.open', label: 'Go to a note' },
    { id: 'note.new', label: 'Create a note' },
    { id: 'search.open', label: 'Search everything' },
    { id: 'palette.open', label: 'Every command' }
  ]

  return (
    <div
      className="empty-state welcome-pane"
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return
        promptNewNote('')
      }}
    >
      <Icon name="book" size={30} />
      <h2>Nothing open</h2>
      <p>Pick a note from the sidebar, or start from here.</p>
      <div className="welcome-shortcuts">
        {shortcuts.map((s) => {
          const command = getCommand(s.id)
          return (
            <button key={s.id} className="welcome-shortcut" onClick={() => runCommand(s.id)}>
              <span>{s.label}</span>
              <span className="picker-hint">
                {command
                  ? acceleratorChips(hotkeyFor(command)).map((k) => <kbd key={k}>{k}</kbd>)
                  : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
