import type { RightPanel } from '@shared/types'
import BacklinksPanel from './BacklinksPanel'
import GraphView from './GraphView'
import { Icon, type IconName } from './Icon'
import OutlinePanel from './OutlinePanel'
import { useWorkspace } from '../store/workspaceStore'

const TABS: { id: RightPanel; icon: IconName; label: string }[] = [
  { id: 'backlinks', icon: 'link', label: 'Backlinks' },
  { id: 'outline', icon: 'outline', label: 'Outline' },
  { id: 'graph', icon: 'graph', label: 'Local graph' }
]

export default function RightSidebar(): React.JSX.Element {
  const panel = useWorkspace((s) => s.rightPanel)
  const setPanel = useWorkspace((s) => s.setRightPanel)

  return (
    <aside className="sidebar right">
      <div className="panel">
        <div className="right-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={panel === tab.id}
              className={`right-tab${panel === tab.id ? ' is-active' : ''}`}
              data-tooltip={`Open ${tab.label}`}
              onClick={() => setPanel(tab.id)}
            >
              <Icon name={tab.icon} size={16} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {panel === 'backlinks' ? <BacklinksPanel /> : null}
        {panel === 'outline' ? <OutlinePanel /> : null}
        {panel === 'graph' ? <GraphView scope="local" depth={2} /> : null}
      </div>
    </aside>
  )
}
