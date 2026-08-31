import { dirname } from '@shared/markdown-parse'
import { Icon } from './Icon'
import { runCommand } from '../lib/commands'
import { useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'
import { titleOf } from '../store/vaultStore'

function revealFolder(folderPath: string): void {
  const workspace = useWorkspace.getState()
  const segments = folderPath ? folderPath.split('/') : []
  const ancestors: string[] = []
  let acc = ''
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg
    ancestors.push(acc)
  }
  const expanded = new Set(workspace.expanded)
  for (const a of ancestors) expanded.add(a)
  workspace.setExpanded([...expanded])
  workspace.setLeftPanel('files')
}

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

      <div className="titlebar-title breadcrumbs">
        {vault ? (
          <button
            className="breadcrumb-segment"
            onClick={() => revealFolder('')}
            title="Show vault root"
          >
            {vault.name}
          </button>
        ) : null}
        {path
          ? (() => {
              const folder = dirname(path)
              const segments = folder ? folder.split('/') : []
              let acc = ''
              return segments.map((seg) => {
                acc = acc ? `${acc}/${seg}` : seg
                const target = acc
                return (
                  <span key={target} className="breadcrumb-item">
                    <span className="breadcrumb-sep">/</span>
                    <button
                      className="breadcrumb-segment"
                      onClick={() => revealFolder(target)}
                      title={`Show ${seg} in the sidebar`}
                    >
                      {seg}
                    </button>
                  </span>
                )
              })
            })()
          : null}
        {vault && path ? (
          <span className="breadcrumb-item">
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current truncate">{label}</span>
          </span>
        ) : !vault ? (
          label
        ) : null}
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
