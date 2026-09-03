import type { LeftPanel } from '@shared/types'
import { Icon, type IconName } from './Icon'
import FileTree from './FileTree'
import ProfileIndicator from './ProfileIndicator'
import SearchPanel from './SearchPanel'
import StarredPane from './StarredPane'
import TagPane from './TagPane'
import { pickVault } from '../lib/actions'
import { commandTooltip, runCommand, useCommandHotkey } from '../lib/commands'
import { useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

const TABS: { id: LeftPanel; icon: IconName; label: string; hint: string }[] = [
  { id: 'files', icon: 'files', label: 'Notes', hint: 'All notes' },
  { id: 'search', icon: 'search', label: 'Search', hint: 'Search' },
  { id: 'tags', icon: 'tag', label: 'Tags', hint: 'Tags' },
  { id: 'starred', icon: 'star', label: 'Starred', hint: 'Starred notes' }
]

export default function Sidebar(): React.JSX.Element {
  const panel = useWorkspace((s) => s.leftPanel)
  const setPanel = useWorkspace((s) => s.setLeftPanel)
  const vault = useVault((s) => s.vault)
  const homeHotkey = useCommandHotkey('view.home')
  const searchHotkey = useCommandHotkey('search.open')
  const settingsHotkey = useCommandHotkey('settings.open')

  return (
    <aside className="sidebar left">
      <nav className="rail" aria-label="Sidebar sections">
        {/* Home is a tab in the workspace rather than a panel, so it sits
            above the panel switches and never takes their pressed state. */}
        <button
          className="icon-btn rail-btn"
          data-tooltip={commandTooltip('Home', homeHotkey)}
          aria-label="Home"
          onClick={() => runCommand('view.home')}
        >
          <Icon name="home" size={18} />
        </button>
        <div className="rail-divider" />

        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`icon-btn rail-btn${panel === tab.id ? ' is-active' : ''}`}
            data-tooltip={tab.id === 'search' ? commandTooltip('Search', searchHotkey) : tab.hint}
            aria-label={tab.label}
            aria-pressed={panel === tab.id}
            onClick={() => setPanel(tab.id)}
          >
            <Icon name={tab.icon} size={18} />
          </button>
        ))}

        <div className="rail-spacer" />

        <ProfileIndicator />
        <button
          className="icon-btn rail-btn"
          data-tooltip={vault ? `Vault: ${vault.name} — click to switch` : 'Open a vault'}
          aria-label="Switch vault"
          onClick={() => void pickVault()}
        >
          <Icon name="vault" size={18} />
        </button>
        <button
          className="icon-btn rail-btn"
          data-tooltip={commandTooltip('Settings', settingsHotkey)}
          aria-label="Settings"
          onClick={() => runCommand('settings.open')}
        >
          <Icon name="settings" size={18} />
        </button>
      </nav>

      <div className="panel">
        {panel === 'files' ? <FileTree /> : null}
        {panel === 'search' ? <SearchPanel /> : null}
        {panel === 'tags' ? <TagPane /> : null}
        {panel === 'starred' ? <StarredPane /> : null}
      </div>
    </aside>
  )
}
