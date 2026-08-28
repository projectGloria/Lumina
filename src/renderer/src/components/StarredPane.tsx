import { Icon } from './Icon'
import { PanelHeader } from './FileTree'
import { openNote, toggleStar } from '../lib/actions'
import { useSettings } from '../store/settingsStore'
import { titleOf, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'
import { dirname } from '@shared/markdown-parse'

export default function StarredPane(): React.JSX.Element {
  const starred = useSettings((s) => s.settings.starred)
  const notes = useVault((s) => s.index.notes)
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const current = tabs[activeTab]?.path

  // Drop entries whose note has since been deleted or renamed away.
  const live = starred.filter((path) => notes[path])

  return (
    <>
      <PanelHeader title="Starred" />
      <div className="panel-scroll tree">
        {live.length ? (
          live.map((path) => (
            <div
              key={path}
              className={`tree-row file${current === path ? ' is-active' : ''}`}
              style={{ paddingLeft: 10 }}
              onClick={(e) => openNote(path, { newTab: e.ctrlKey || e.metaKey })}
            >
              <span className="tree-label truncate">{titleOf(path)}</span>
              {dirname(path) ? <span className="tree-count truncate">{dirname(path)}</span> : null}
              <button
                className="icon-btn tree-star-btn"
                title="Remove from starred"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleStar(path)
                }}
              >
                <Icon name="star" size={13} />
              </button>
            </div>
          ))
        ) : (
          <p className="panel-empty">
            Nothing starred yet. Right-click a note to keep it here.
          </p>
        )}
      </div>
    </>
  )
}
