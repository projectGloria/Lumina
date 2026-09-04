/**
 * What the player draws.
 *
 * Only the phase: the `HTMLAudioElement` itself lives module-level in
 * `lib/musicPlayer.ts`, the same split `lib/voice.ts` keeps with `uiStore`.
 *
 * Deliberately **not** reset when the vault changes. Music is app-level — the
 * folder belongs to the machine, not to a vault — so `App.tsx` leaves this
 * store out of `receive()` and a track keeps playing across a vault switch.
 */
import { create } from 'zustand'
import type { MusicTrack } from '@shared/types'
import type { QueueState } from '@shared/music'

/** Why the library is empty, which is not always the same as "no music". */
export type LibraryState =
  /** No folder has been chosen yet. */
  | 'unset'
  /** Not read this session. */
  | 'idle'
  | 'loading'
  | 'ready'
  /**
   * The folder is set but could not be read — an unplugged drive, a share
   * that is not mounted, a path that has been deleted. Kept apart from a
   * library with nothing in it, because they call for different words.
   */
  | 'unreachable'

interface MusicState {
  tracks: MusicTrack[]
  library: LibraryState
  /** The folder the last listing looked in, for the unreachable message. */
  root: string | null
  /** True when the library is larger than the cap and the list stops short. */
  truncated: boolean

  queue: QueueState | null
  current: MusicTrack | null
  playing: boolean
  /** Seconds, refreshed on a timer while playing rather than per frame. */
  position: number
  duration: number
  volume: number

  /** The expanded panel, as against the strip in the status bar. */
  expanded: boolean

  /**
   * Read the folder, at most once a session unless asked again.
   *
   * Called when the player is first opened or the Home widget mounts — never
   * at startup. Lumina comes up into the tray with no vault indexed and has to
   * answer a global shortcut on the first press; a twenty-thousand-file walk
   * has no business anywhere near that.
   */
  load: (force?: boolean) => Promise<void>
  setExpanded: (expanded: boolean) => void
}

export const useMusic = create<MusicState>((set, get) => ({
  tracks: [],
  library: 'idle',
  root: null,
  truncated: false,
  queue: null,
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  expanded: false,

  load: async (force = false) => {
    const state = get()
    if (state.library === 'loading') return
    if (!force && state.library === 'ready') return

    // A forced read is either a refresh or a new folder, and in both cases the
    // art answers remembered from before are about files nobody is asking
    // about now.
    if (force) {
      const { forgetArt } = await import('@/lib/musicArt')
      forgetArt()
    }

    set({ library: 'loading' })
    try {
      const listing = await window.lumina.music.list()
      set({
        tracks: listing.tracks,
        root: listing.root,
        truncated: listing.truncated,
        library: !listing.root ? 'unset' : listing.ok ? 'ready' : 'unreachable'
      })

      // Put the needle back where it was, paused. Deliberately here rather
      // than at startup: the library has to be read before a track can be
      // found in it, and reading it is what this call is. Nothing plays until
      // asked — an app that starts making noise because it was launched is an
      // app people uninstall.
      if (listing.ok && listing.tracks.length && !get().current) {
        const { restoreLastTrack } = await import('@/lib/musicPlayer')
        restoreLastTrack(listing.tracks)
      }
    } catch {
      // The listing failing outright is the same story as the folder being
      // unreachable, and gets the same words rather than a toast.
      set({ library: 'unreachable', tracks: [] })
    }
  },

  setExpanded: (expanded) => set({ expanded })
}))
