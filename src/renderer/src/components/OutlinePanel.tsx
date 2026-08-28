import { PanelHeader } from './FileTree'
import { getActiveView } from '../editor/activeView'
import { revealLine } from '../editor/format'
import { useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

export default function OutlinePanel(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const index = useVault((s) => s.index)
  const path = tabs[activeTab]?.path ?? null
  const headings = path ? (index.notes[path]?.headings ?? []) : []

  // Indent relative to the shallowest heading, so a note that starts at H2
  // still reads as a flat outline rather than one indented by a level.
  const base = headings.length ? Math.min(...headings.map((h) => h.level)) : 1

  return (
    <>
      <PanelHeader title="Outline" />
      <div className="panel-scroll">
        {headings.length ? (
          headings.map((h, i) => (
            <button
              key={`${h.line}-${i}`}
              className={`outline-row level-${h.level}`}
              style={{ paddingLeft: 12 + (h.level - base) * 13 }}
              onClick={() => {
                const view = getActiveView()
                if (view) revealLine(view, h.line)
              }}
            >
              <span className="truncate">{h.text}</span>
            </button>
          ))
        ) : (
          <p className="panel-empty">
            {path ? 'This note has no headings yet.' : 'Open a note to see its outline.'}
          </p>
        )}
      </div>
    </>
  )
}
