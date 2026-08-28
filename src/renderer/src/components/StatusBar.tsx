import { Icon } from './Icon'
import { runCommand } from '../lib/commands'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'
import { countWords } from '@shared/markdown-parse'

/** Reading pace people quote for prose; close enough to be useful. */
const WORDS_PER_MINUTE = 220

export default function StatusBar(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const path = tabs[activeTab]?.path ?? null

  const buffer = useEditor((s) => (path ? s.buffers[path] : undefined))
  const saving = useEditor((s) => s.saving.length > 0)
  const index = useVault((s) => s.index)
  const mode = useSettings((s) => s.mode)
  const focusMode = useWorkspace((s) => s.focusMode)

  const words = buffer && !buffer.loading ? countWords(buffer.content) : 0
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE))
  const backlinks = path ? (index.backlinks[path]?.length ?? 0) : 0
  const dirty = !!buffer && !buffer.loading && buffer.content !== buffer.saved

  return (
    <footer className="statusbar">
      {path ? (
        <>
          <span>{words.toLocaleString()} words</span>
          <span>{minutes} min read</span>
          <span>
            {backlinks} backlink{backlinks === 1 ? '' : 's'}
          </span>
        </>
      ) : (
        <span>{Object.keys(index.notes).length} notes</span>
      )}

      <span className="statusbar-spacer" />

      {saving ? <span>Saving…</span> : dirty ? <span>Unsaved</span> : path ? <span>Saved</span> : null}

      <button
        className="icon-btn"
        title={focusMode ? 'Leave focus mode' : 'Focus mode  (Ctrl+Shift+M)'}
        aria-label="Toggle focus mode"
        onClick={() => runCommand('view.focusMode')}
      >
        <Icon name="focus" size={14} />
      </button>
      <button
        className="icon-btn"
        title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}
        aria-label="Toggle theme"
        onClick={() => runCommand('view.toggleTheme')}
      >
        <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={14} />
      </button>
      <button
        className="icon-btn"
        title="Settings  (Ctrl+,)"
        aria-label="Settings"
        onClick={() => runCommand('settings.open')}
      >
        <Icon name="settings" size={14} />
      </button>
    </footer>
  )
}
