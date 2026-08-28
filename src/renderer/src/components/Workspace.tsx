import Editor from '../editor/Editor'
import TabBar from './TabBar'
import { Icon } from './Icon'
import { getCommand, hotkeyFor, runCommand } from '../lib/commands'
import { acceleratorChips } from '../lib/hotkeys'
import { useWorkspace } from '../store/workspaceStore'

export default function Workspace(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const path = tabs[activeTab]?.path

  return (
    <main className="pane-main">
      <TabBar />
      {path ? <Editor key={path} path={path} /> : <NoNoteOpen />}
    </main>
  )
}

/** What the editor area shows before anything is open. */
function NoNoteOpen(): React.JSX.Element {
  const shortcuts = [
    { id: 'switcher.open', label: 'Go to a note' },
    { id: 'note.new', label: 'Create a note' },
    { id: 'search.open', label: 'Search everything' },
    { id: 'palette.open', label: 'Every command' }
  ]

  return (
    <div className="empty-state welcome-pane">
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
