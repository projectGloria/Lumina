import { dirname } from '@shared/markdown-parse'
import { Icon } from './Icon'
import PathIcon from './PathIcon'
import { commandTooltip, runCommand, useCommandHotkey } from '../lib/commands'
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
  const leftHotkey = useCommandHotkey('view.toggleLeft')
  const backHotkey = useCommandHotkey('nav.back')
  const forwardHotkey = useCommandHotkey('nav.forward')
  const switcherHotkey = useCommandHotkey('switcher.open')
  const rightHotkey = useCommandHotkey('view.toggleRight')

  const tab = tabs[activeTab]
  const home = tab?.kind === 'home'
  // Home names no file, so it gets a crumb of its own rather than a path.
  const path = home ? undefined : tab?.path
  const label = path ? titleOf(path) : (vault?.name ?? 'Lumina')

  return (
    <header className="titlebar">
      <button
        className={`icon-btn${leftOpen ? ' is-active' : ''}`}
        data-tooltip={commandTooltip('Toggle left sidebar', leftHotkey)}
        aria-label="Toggle left sidebar"
        onClick={() => runCommand('view.toggleLeft')}
      >
        <Icon name="panelLeft" />
      </button>

      <button
        className="icon-btn"
        data-tooltip={commandTooltip('Back', backHotkey)}
        aria-label="Back"
        disabled={historyIndex <= 0}
        style={{ opacity: historyIndex <= 0 ? 0.35 : 1 }}
        onClick={() => runCommand('nav.back')}
      >
        <Icon name="back" />
      </button>
      <button
        className="icon-btn"
        data-tooltip={commandTooltip('Forward', forwardHotkey)}
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
            data-tooltip="Show vault root"
          >
            <Icon name="vault" size={15} className="breadcrumb-icon" />
            <span>{vault.name}</span>
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
                      data-tooltip={`Show ${seg} in the sidebar`}
                    >
                      <PathIcon path={target} kind="folder" size={15} className="breadcrumb-icon" />
                      <span>{seg}</span>
                    </button>
                  </span>
                )
              })
            })()
          : null}
        {vault && home ? (
          <span className="breadcrumb-item">
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current truncate">
              <Icon name="home" size={15} className="breadcrumb-icon" />
              <span className="truncate">Home</span>
            </span>
          </span>
        ) : null}
        {vault && path ? (
          <span className="breadcrumb-item">
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current truncate">
              <PathIcon path={path} size={15} className="breadcrumb-icon" />
              <span className="truncate">{label}</span>
            </span>
          </span>
        ) : !vault ? (
          label
        ) : null}
      </div>

      <button
        className="icon-btn"
        data-tooltip={commandTooltip('Go to note or feature', switcherHotkey)}
        aria-label="Go to note"
        onClick={() => runCommand('switcher.open')}
      >
        <Icon name="search" />
      </button>
      <button
        className={`icon-btn${rightOpen && !home ? ' is-active' : ''}`}
        data-tooltip={
          home
            ? 'Home uses this space for the board'
            : commandTooltip('Toggle right sidebar', rightHotkey)
        }
        aria-label="Toggle right sidebar"
        disabled={home}
        onClick={() => runCommand('view.toggleRight')}
      >
        <Icon name="panelRight" />
      </button>

      <div className="titlebar-spacer" />
    </header>
  )
}
