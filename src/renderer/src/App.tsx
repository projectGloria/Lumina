import { useEffect } from 'react'
import type { VaultPayload } from '../../preload'
import CommandPalette from './components/CommandPalette'
import ContextMenu from './components/ContextMenu'
import { ConfirmDialog, PromptDialog } from './components/Dialogs'
import GraphModal from './components/GraphModal'
import QuickSwitcher from './components/QuickSwitcher'
import Resizer from './components/Resizer'
import RightSidebar from './components/RightSidebar'
import SettingsModal from './components/settings/SettingsModal'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import Toasts from './components/Toasts'
import Welcome from './components/Welcome'
import Workspace from './components/Workspace'
import { COMMANDS, hotkeyFor } from './lib/commands'
import { matchesAccelerator } from './lib/hotkeys'
import { useEditor } from './store/editorStore'
import { useSettings } from './store/settingsStore'
import { useUi } from './store/uiStore'
import { useVault } from './store/vaultStore'
import { useWorkspace } from './store/workspaceStore'

export default function App(): React.JSX.Element {
  const vault = useVault((s) => s.vault)
  const modal = useUi((s) => s.modal)
  const leftOpen = useWorkspace((s) => s.leftOpen)
  const rightOpen = useWorkspace((s) => s.rightOpen)
  const leftWidth = useWorkspace((s) => s.leftWidth)
  const rightWidth = useWorkspace((s) => s.rightWidth)
  const focusMode = useWorkspace((s) => s.focusMode)

  /* ------------------------------------------------------ main process */
  useEffect(() => {
    const receive = (payload: VaultPayload): void => {
      useSettings.getState().hydrate(payload.settings, payload.theme, payload.snippets)
      useWorkspace.getState().hydrate(payload.workspace)
      useVault.getState().setVault(payload.vault, payload.tree, payload.index)

      // Load the note that was open last time so the app resumes where it was.
      const active = payload.workspace.tabs[payload.workspace.activeTab]
      if (active) void useEditor.getState().open(active.path)
    }

    const unsubscribers = [
      window.lumina.vault.onOpened(receive),

      window.lumina.vault.onChanged(({ changes, tree, index }) => {
        if (tree) useVault.getState().setTree(tree)
        useVault.getState().setIndex(index)
        for (const change of changes) {
          if (change.type === 'change') void useEditor.getState().externalChange(change.path)
          else if (change.type === 'unlink') {
            useEditor.getState().close(change.path)
            useWorkspace.getState().removePathFromTabs(change.path)
          }
        }
      }),

      window.lumina.index.onUpdated((index) => useVault.getState().setIndex(index)),
      window.lumina.snippets.onChanged((snippets) => useSettings.getState().setSnippets(snippets))
    ]

    // A vault may already be open by the time React mounts.
    void window.lumina.vault.current().then((payload) => {
      if (payload) receive(payload)
    })

    return () => unsubscribers.forEach((off) => off())
  }, [])

  /* --------------------------------------------------- system dark mode */
  useEffect(() => {
    // Paint the theme immediately, before any vault has loaded. Without this
    // the welcome screen renders with the stylesheet defaults while the native
    // window buttons keep the colour chosen at window creation, and the two
    // disagree on anything but a light system theme.
    useSettings.getState().refreshMode()

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => useSettings.getState().refreshMode()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  /* ---------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inEditor = !!target?.closest('.cm-editor')
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      for (const command of COMMANDS) {
        const accel = hotkeyFor(command)
        if (!accel || !matchesAccelerator(e, accel)) continue

        // CodeMirror owns the formatting keys while the editor has focus.
        if (inEditor && command.section === 'Editor') return
        // Bare keys like F2 stay out of the way of ordinary typing.
        if (inField && !e.ctrlKey && !e.altKey && !e.metaKey) return
        if (command.enabled && !command.enabled()) return

        e.preventDefault()
        command.run()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ---------------------------------------------- flush before closing */
  useEffect(() => {
    const flush = (): void => {
      void useEditor.getState().saveAll()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('blur', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('blur', flush)
    }
  }, [])

  if (!vault) {
    return (
      <div className="app no-vault">
        <TitleBar />
        <Welcome />
        <Toasts />
      </div>
    )
  }

  return (
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      <TitleBar />

      <div className="app-body">
        {leftOpen && !focusMode ? (
          <>
            <div className="sidebar-slot" style={{ width: leftWidth }}>
              <Sidebar />
            </div>
            <Resizer side="left" width={leftWidth} onResize={useWorkspace.getState().setLeftWidth} />
          </>
        ) : null}

        <Workspace />

        {rightOpen && !focusMode ? (
          <>
            <Resizer
              side="right"
              width={rightWidth}
              onResize={useWorkspace.getState().setRightWidth}
            />
            <div className="sidebar-slot" style={{ width: rightWidth }}>
              <RightSidebar />
            </div>
          </>
        ) : null}
      </div>

      <StatusBar />

      {modal === 'palette' ? <CommandPalette /> : null}
      {modal === 'switcher' ? <QuickSwitcher /> : null}
      {modal === 'settings' ? <SettingsModal /> : null}
      {modal === 'graph' ? <GraphModal /> : null}

      <PromptDialog />
      <ConfirmDialog />
      <ContextMenu />
      <Toasts />
    </div>
  )
}
