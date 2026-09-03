import { isMarkdownPath } from '@shared/markdown-parse'
import PathIcon from '@/components/PathIcon'
import { openNote } from '@/lib/actions'
import { useSettings } from '@/store/settingsStore'
import { titleOf } from '@/store/vaultStore'
import { useWorkspace } from '@/store/workspaceStore'
import { defineWidget } from './types'

/**
 * Starred and pinned are the same card over two different lists, so they share
 * a component and differ only in their registry entries.
 */
function PathList({ paths, empty }: { paths: string[]; empty: string }): React.JSX.Element {
  if (!paths.length) return <p className="home-widget-empty">{empty}</p>

  return (
    <ul className="home-list">
      {paths.map((path) => (
        <li key={path}>
          <button className="home-row" data-tooltip={path} onClick={() => reveal(path)}>
            <PathIcon path={path} size={15} className="home-row-icon" />
            <span className="home-row-label truncate">{titleOf(path)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Pinned holds folders as well as notes, and a folder cannot be opened in a
 * tab — showing it in the explorer is the nearest thing to opening it.
 */
function reveal(path: string): void {
  if (isMarkdownPath(path)) {
    openNote(path)
    return
  }
  const workspace = useWorkspace.getState()
  const expanded = new Set(workspace.expanded)
  let acc = ''
  for (const segment of path.split('/')) {
    acc = acc ? `${acc}/${segment}` : segment
    expanded.add(acc)
  }
  workspace.setExpanded([...expanded])
  workspace.setLeftPanel('files')
}

function Starred(): React.JSX.Element {
  const starred = useSettings((s) => s.settings.starred)
  return <PathList paths={starred} empty="Star a note to keep it here." />
}

function Pinned(): React.JSX.Element {
  const pinned = useSettings((s) => s.settings.pinned)
  return <PathList paths={pinned} empty="Pin a note or folder to keep it here." />
}

export const starredWidget = defineWidget<Record<string, unknown>>({
  type: 'starred',
  name: 'Starred',
  description: 'The notes you starred',
  icon: 'star',
  defaultSize: { w: 2, h: 3 },
  minSize: { w: 1, h: 1 },
  defaultConfig: {},
  Component: Starred
})

export const pinnedWidget = defineWidget<Record<string, unknown>>({
  type: 'pinned',
  name: 'Pinned',
  description: 'What you pinned to the top of the file explorer',
  icon: 'pin',
  defaultSize: { w: 2, h: 3 },
  minSize: { w: 1, h: 1 },
  defaultConfig: {},
  Component: Pinned
})
