import { useEffect } from 'react'
import type { FileOpenRequest } from '@shared/types'
import { isNoteTab } from '@shared/types'
import type { VaultPayload } from '../../preload'
import CommandPalette from './components/CommandPalette'
import ContextMenu from './components/ContextMenu'
import { ConfirmDialog, PromptDialog } from './components/Dialogs'
import GraphModal from './components/GraphModal'
import PasslockScreen from './components/PasslockScreen'
import ProfilePicker from './components/ProfilePicker'
import QuickSwitcher from './components/QuickSwitcher'
import Resizer from './components/Resizer'
import SaveIndicator from './components/SaveIndicator'
import RightSidebar from './components/RightSidebar'
import SettingsModal from './components/settings/SettingsModal'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import SpeechSetup from './components/SpeechSetup'
import Toasts from './components/Toasts'
import VoiceRecorder from './components/VoiceRecorder'
import SpeechPlayer from './components/SpeechPlayer'
import Welcome from './components/Welcome'
import Workspace from './components/Workspace'
import { Icon } from './components/Icon'
import { getActiveView } from './editor/activeView'
import { rememberPosition } from './lib/musicPlayer'
import { captureActiveSession } from './editor/session'
import {
  drainQuickNotes,
  openNote,
  removeStarredPaths,
  removeIconOverrides,
  removePinnedPaths,
  requestQuickNote
} from './lib/actions'
import { defaultLayout } from './home/widgets/defaults'
import { drainClips, requestClip } from './lib/clipToNote'
import { COMMANDS, hotkeyFor, runCommand } from './lib/commands'
import { matchesAccelerator } from './lib/hotkeys'
import { useEditor } from './store/editorStore'
import { flushHomePersistence, useHome } from './store/homeStore'
import { useProfiles } from './store/profileStore'
import { flushSettingsPersistence, useSettings } from './store/settingsStore'
import { toast, useUi } from './store/uiStore'
import { useVault } from './store/vaultStore'
import { activePath, flushWorkspacePersistence, useWorkspace } from './store/workspaceStore'

export default function App(): React.JSX.Element {
  const vault = useVault((s) => s.vault)
  const settingsReady = useSettings((s) => s.ready)
  const voiceSetupPrompted = useSettings((s) => s.settings.voice.setupPrompted)
  const profileStatus = useProfiles((s) => s.status)
  const modal = useUi((s) => s.modal)
  const leftOpen = useWorkspace((s) => s.leftOpen)
  const rightOpen = useWorkspace((s) => s.rightOpen)
  const leftWidth = useWorkspace((s) => s.leftWidth)
  const rightWidth = useWorkspace((s) => s.rightWidth)
  const focusMode = useWorkspace((s) => s.focusMode)
  // Home gives the board the width of the right sidebar while it is on
  // screen. `rightOpen` itself is untouched, so a note tab gets the workspace
  // back exactly as it was arranged. The file list stays: moving between the
  // board and a note is the point of having both.
  const homeActive = useWorkspace((s) => s.tabs[s.activeTab]?.kind === 'home')

  /* --------------------------------------------------------- profiles */
  useEffect(() => {
    void useProfiles.getState().init()
  }, [])

  /* ------------------------------------------- leave focus mode safely */
  useEffect(() => {
    if (!focusMode) return
    const leave = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      useWorkspace.getState().toggleFocusMode()
    }
    window.addEventListener('keydown', leave)
    return () => window.removeEventListener('keydown', leave)
  }, [focusMode])

  /* ------------------------------------------------------ main process */
  useEffect(() => {
    const receive = (payload: VaultPayload): void => {
      // A different vault means every buffer belongs to the old one. Main has
      // already flushed them, so dropping them here loses nothing.
      if (useVault.getState().vault?.path !== payload.vault.path) {
        useEditor.getState().reset()
      }
      // The board is per vault, so the outgoing one's widgets must not linger
      // long enough to be saved into the incoming vault's `home.json`.
      useHome.getState().reset()

      const starred = payload.settings.starred.filter((path) => !!payload.index.notes[path])
      useSettings
        .getState()
        .hydrate({ ...payload.settings, starred }, payload.theme, payload.snippets)
      if (starred.length !== payload.settings.starred.length) {
        useSettings.getState().patch({ starred })
      }
      // A tab whose note is gone is dropped; Home names no note and is kept.
      const activeTabState = payload.workspace.tabs[payload.workspace.activeTab]
      const tabs = payload.workspace.tabs.filter(
        (tab) => !isNoteTab(tab) || !!payload.index.notes[tab.path]
      )
      const activeTab = Math.max(0, tabs.indexOf(activeTabState))
      const workspace = { ...payload.workspace, tabs, activeTab }
      useWorkspace.getState().hydrate(workspace)
      useVault.getState().setVault(payload.vault, payload.tree, payload.index)
      useProfiles.getState().noteVaultPath(payload.vault.path)

      // Load the note that was open last time so the app resumes where it was.
      const active = workspace.tabs[workspace.activeTab]
      if (active && isNoteTab(active)) void useEditor.getState().open(active.path)

      void useHome.getState().load(defaultLayout)
      // Opening on Home is only ever an offer to fill an empty workspace —
      // never something that displaces the note the user left open.
      if (!workspace.tabs.length && payload.settings.home.openOnLaunch) {
        useWorkspace.getState().openHome()
      }

      // A quick note asked for while the picker or the passlock was up has
      // been waiting for exactly this.
      void drainQuickNotes()
      void drainClips()
    }

    // A note double-clicked in the file manager. The main process has already
    // opened the right vault unless it had to guess at one, in which case it
    // asks rather than indexing wherever the file happened to live.
    const openRequested = ({ path, ask }: FileOpenRequest): void => {
      if (!ask) {
        // A note arriving from outside gets its own tab: replacing the active
        // one would throw away whatever the user was in the middle of. An
        // already-open note is focused instead of opened twice.
        const open = useWorkspace.getState().tabs.some((tab) => tab.path === path)
        openNote(path, { newTab: !open })
        return
      }
      useUi.getState().showConfirm({
        title: `Open “${ask.name}” as a vault?`,
        body:
          `${path} is not inside a vault Lumina knows about. Opening its folder ` +
          `as a vault lets Lumina index the notes beside it.`,
        confirmLabel: 'Open folder',
        onConfirm: () => {
          void window.lumina.files.adoptVault(ask.file).catch((err) => {
            toast(`Could not open the folder: ${(err as Error).message}`, 'error')
          })
        }
      })
    }

    const unsubscribers = [
      window.lumina.vault.onOpened(receive),

      window.lumina.vault.onChanged(({ changes, tree, index }) => {
        if (tree) useVault.getState().setTree(tree)
        useVault.getState().setIndex(index)
        for (const change of changes) {
          if (change.type === 'change') void useEditor.getState().externalChange(change.path)
          else if (change.type === 'unlink' || change.type === 'unlinkDir') {
            useEditor.getState().close(change.path)
            useWorkspace.getState().removePathFromTabs(change.path)
            removeStarredPaths(change.path)
            removeIconOverrides(change.path)
            removePinnedPaths(change.path)
          }
        }
      }),

      window.lumina.files.onOpenRequest(openRequested),

      // The OS-wide shortcut. The window may have been created by the press
      // itself, so this can arrive before there is a vault — `requestQuickNote`
      // holds it until there is one.
      window.lumina.quickNote.onRequest(() => requestQuickNote()),

      // A page clipped from the browser. The window may have been built by the
      // clip itself, so this can arrive before a vault is open — `requestClip`
      // holds it until there is one.
      window.lumina.clipper.onClip((clip) => requestClip(clip)),

      window.lumina.quickNote.onStatus(({ accelerator, registered }) => {
        if (!registered) {
          toast(`${accelerator} could not be registered — another app may own it`, 'error')
        }
      }),

      // The app is quitting and the main process is waiting on us. Autosave is
      // debounced, so the last few keystrokes live only here until this runs.
      window.lumina.app.onFlush(() => {
        // Synchronous, and before the workspace flush below, so the caret in
        // the note on screen is part of what gets written out.
        captureActiveSession(activePath(), getActiveView())
        // Where the music got to. One of the three moments it is written
        // down — there is no heartbeat, so this is what makes "carry on where
        // I left off" survive a normal quit.
        rememberPosition()
        void Promise.all([
          useEditor.getState().saveAll(),
          flushSettingsPersistence(),
          flushWorkspacePersistence(),
          flushHomePersistence()
        ])
          .finally(() => window.lumina.app.flushed())
      }),

      window.lumina.index.onUpdated((index) => useVault.getState().setIndex(index)),
      window.lumina.snippets.onChanged((snippets) => useSettings.getState().setSnippets(snippets))
    ]

    // A vault may already be open by the time React mounts, and a note passed
    // on the command line may already have been resolved against it.
    void (async () => {
      try {
        const payload = await window.lumina.vault.current()
        if (payload) receive(payload)
      } catch (err) {
        toast(`Could not restore the vault: ${(err as Error).message}`, 'error')
      }

      // File requests must still drain when restoring the previous vault fails.
      try {
        const requests = await window.lumina.files.takeOpenRequests()
        requests.forEach(openRequested)
      } catch (err) {
        toast(`Could not open the requested note: ${(err as Error).message}`, 'error')
      }

      // Shortcut presses that landed during the window's cold start — the
      // usual case when the app was idling in the tray.
      try {
        const presses = await window.lumina.quickNote.takePending()
        for (let i = 0; i < presses; i++) requestQuickNote()
      } catch (err) {
        toast(`Could not create the quick note: ${(err as Error).message}`, 'error')
      }

      // Clips that landed during the same cold start. Drained in their own
      // block so a failed quick note does not swallow a clipped page.
      try {
        const clips = await window.lumina.clipper.takePending()
        clips.forEach(requestClip)
      } catch (err) {
        toast(`Could not save the clip: ${(err as Error).message}`, 'error')
      }
    })()

    return () => unsubscribers.forEach((off) => off())
  }, [])

  /* ------------------------------------------- first-run speech setup */
  // Offered once, and only when it can actually be acted on: this build has to
  // carry packs, none may be installed yet, and there has to be a vault open —
  // asking about dictation in front of the profile picker would be noise.
  useEffect(() => {
    if (!vault || !settingsReady || voiceSetupPrompted) return
    let cancelled = false

    void (async () => {
      try {
        const packs = await window.lumina.voice.packs()
        if (cancelled) return
        const bundled = packs.some((pack) => pack.bundled)
        const ready = packs.some((pack) => pack.kind === 'engine' && pack.installed)
        if (bundled && !ready) useUi.getState().openModal('speechSetup')
        // A build with nothing bundled has nothing to offer, so the question is
        // answered by never asking it.
        else if (!bundled) useSettings.getState().patch({ voice: { setupPrompted: true } })
      } catch {
        // Speech setup is an offer, not a requirement; a failure here is silent.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [vault, settingsReady, voiceSetupPrompted])

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

        // CodeMirror owns formatting and save while the editor has focus. Save
        // needs the mounted editor's path and feedback callback, not a second
        // global dispatch of the same keystroke.
        if (inEditor && (command.section === 'Editor' || command.id === 'note.save')) return
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

  if (profileStatus === 'loading') {
    return <div className="app no-vault" />
  }

  if (profileStatus === 'picker') {
    return (
      <div className="app no-vault">
        <TitleBar />
        <ProfilePicker />
        <Toasts />
      </div>
    )
  }

  if (profileStatus === 'locked') {
    return (
      <div className="app no-vault">
        <TitleBar />
        <PasslockScreen />
        <Toasts />
      </div>
    )
  }

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

        {rightOpen && !focusMode && !homeActive ? (
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

      {focusMode ? (
        <button
          className="focus-mode-exit"
          onClick={() => runCommand('view.focusMode')}
          data-tooltip="Leave focus mode (Esc)"
          aria-label="Leave focus mode"
        >
          <Icon name="focus" size={15} />
          <span>Exit focus</span>
          <kbd>Esc</kbd>
        </button>
      ) : null}

      {modal === 'palette' ? <CommandPalette /> : null}
      {modal === 'switcher' ? <QuickSwitcher /> : null}
      {modal === 'settings' ? <SettingsModal /> : null}
      {modal === 'graph' ? <GraphModal /> : null}
      {modal === 'speechSetup' ? <SpeechSetup /> : null}

      <PromptDialog />
      <ConfirmDialog />
      <ContextMenu />
      <SaveIndicator />
      <VoiceRecorder />
      <SpeechPlayer />
      <Toasts />
    </div>
  )
}
