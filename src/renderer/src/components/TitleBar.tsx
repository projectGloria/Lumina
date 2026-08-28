import { Icon } from './Icon'
import { runCommand } from '../lib/commands'
import { useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'
import { titleOf } from '../store/vaultStore'

/**
 * The window title bar.
 *
 * The window is frameless and the OS draws its buttons into an overlay on the
 * right, so this row owns everything else: it is the drag region, and it holds
 * the navigation and sidebar controls that would otherwise need a menu bar.
 */
export default function TitleBar(): React.JSX.Element {
  const vault = useVault((s) => s.vault)
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const leftOpen = useWorkspace((s) => s.leftOpen)
  const rightOpen = useWorkspace((s) => s.rightOpen)
  const history = useWorkspace((s) => s.history)
  const historyIndex = useWorkspace((s) => s.historyIndex)

  const path = tabs[activeTab]?.path
  const label = path ? titleOf(path) : (vault?.name ?? 'Lumina')

  return (
    <header className="titlebar">
      <button
        className={`icon-btn${leftOpen ? ' is-active' : ''}`}
        title="Toggle left sidebar  (Ctrl+\\)"
        aria-label="Toggle left sidebar"
        onClick={() => runCommand('view.toggleLeft')}
      >
        <Icon name="panelLeft" />
      </button>

      <button
        className="icon-btn"
        title="Back  (Alt+Left)"
        aria-label="Back"
        disabled={historyIndex <= 0}
        style={{ opacity: historyIndex <= 0 ? 0.35 : 1 }}
        onClick={() => runCommand('nav.back')}
      >
        <Icon name="back" />
      </button>
      <button
        className="icon-btn"
        title="Forward  (Alt+Right)"
        aria-label="Forward"
        disabled={historyIndex >= history.length - 1}
        style={{ opacity: historyIndex >= history.length - 1 ? 0.35 : 1 }}
        onClick={() => runCommand('nav.forward')}
      >
        <Icon name="forward" />
      </button>

      <div className="titlebar-title">
        {vault && path ? (
          <>
            <span style={{ color: 'var(--lum-text-faint)' }}>{vault.name}</span>
            <span style={{ color: 'var(--lum-text-faint)', margin: '0 6px' }}>/</span>
          </>
        ) : null}
        {label}
      </div>

      <button
        className="icon-btn"
        title="Go to note  (Ctrl+P)"
        aria-label="Go to note"
        onClick={() => runCommand('switcher.open')}
      >
        <Icon name="search" />
      </button>
      <button
        className={`icon-btn${rightOpen ? ' is-active' : ''}`}
        title="Toggle right sidebar  (Ctrl+Shift+\\)"
        aria-label="Toggle right sidebar"
        onClick={() => runCommand('view.toggleRight')}
      >
        <Icon name="panelRight" />
      </button>

      <div className="titlebar-spacer" />
    </header>
  )
}
