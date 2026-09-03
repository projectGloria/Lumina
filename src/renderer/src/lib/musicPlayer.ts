/**
 * The thing that actually makes noise.
 *
 * The `HTMLAudioElement` is module-level and never React state, for the reason
 * `lib/voice.ts` keeps its `RecorderHandle` that way: it is not serialisable,
 * it outlives every component that shows it, and putting it in a store would
 * make a component re-render on every timeupdate. Only the phase the UI draws
 * goes through `musicStore`.
 */
import {
  createQueue,
  currentTrack,
  dropTrack,
  onTrackEnd,
  setRepeat,
  setShuffle,
  skip,
  type Repeat
} from '@shared/music'
import type { MusicSettings, MusicTrack } from '@shared/types'
import { useMusic } from '@/store/musicStore'
import { useSettings } from '@/store/settingsStore'
import { toast } from '@/store/uiStore'

/** Built on first use, so a session that never plays anything never makes one. */
let audio: HTMLAudioElement | null = null

/** How often the drawn position is refreshed while playing. */
const TICK_MS = 250
let tick: ReturnType<typeof setInterval> | null = null

/**
 * Tracks skipped past because they would not play.
 *
 * A missing file skips forward quietly rather than stopping, but a folder that
 * has gone would otherwise skip through the whole library one toast at a time.
 * Once every remaining track has failed, the player stops.
 */
let failures = 0

export function musicUrl(path: string): string {
  return `lumina://music/${path.split('/').map(encodeURIComponent).join('/')}`
}

function element(): HTMLAudioElement {
  if (audio) return audio
  const el = new Audio()
  el.preload = 'metadata'
  el.volume = useSettings.getState().settings.music.volume

  el.addEventListener('loadedmetadata', () => {
    useMusic.setState({ duration: Number.isFinite(el.duration) ? el.duration : 0 })
  })
  el.addEventListener('play', () => useMusic.setState({ playing: true }))
  el.addEventListener('pause', () => {
    useMusic.setState({ playing: false })
    // One of the three moments the position is written down; there is no
    // heartbeat, because rewriting settings on a timer for the length of an
    // album is a lot of disk for a place in a track nobody would miss.
    rememberPosition()
  })
  el.addEventListener('ended', () => {
    failures = 0
    advance('ended')
  })
  el.addEventListener('error', () => {
    const track = currentDetails()
    if (track) toast(`Skipping ${track.path} — it is no longer there`)
    forgetCurrent()
  })

  audio = el
  return el
}

/** The track the queue is pointing at, as a library entry. */
function currentDetails(): MusicTrack | null {
  const { tracks, queue } = useMusic.getState()
  const index = queue ? currentTrack(queue) : null
  return index === null ? null : (tracks[index] ?? null)
}

/** Push the queue's current track into the element and the store. */
function load(play: boolean, position = 0): void {
  const track = currentDetails()
  const el = element()
  if (!track) {
    el.pause()
    el.removeAttribute('src')
    useMusic.setState({ current: null, playing: false, position: 0, duration: 0 })
    return
  }

  useMusic.setState({ current: track, position, duration: 0 })
  el.src = musicUrl(track.path)
  el.currentTime = 0
  if (position > 0) {
    // `currentTime` before metadata arrives is discarded, so a restored
    // position has to wait for the file to say how long it is.
    el.addEventListener('loadedmetadata', () => { el.currentTime = position }, { once: true })
  }
  if (play) void el.play().catch(() => {})
}

/**
 * A track that would not play: drop it and move on.
 *
 * Quietly, and forward — a library on an unplugged drive should stop rather
 * than announce every track it cannot find.
 */
function forgetCurrent(): void {
  const { tracks, queue } = useMusic.getState()
  const index = queue ? currentTrack(queue) : null
  if (!queue || index === null) return stop()

  failures++
  const remaining = tracks.filter((_, i) => i !== index)
  const next = dropTrack(queue, index)
  useMusic.setState({ tracks: remaining, queue: next })

  if (!remaining.length || failures > Math.min(remaining.length, 10)) {
    toast('Nothing in the music folder could be played', 'error')
    return stop()
  }
  load(true, 0)
}

function startTicking(): void {
  if (tick) return
  tick = setInterval(() => {
    const el = audio
    if (!el || el.paused) return
    useMusic.setState({ position: el.currentTime })
  }, TICK_MS)
}

/* --------------------------------------------------------------- the verbs */

/** Play the library from `index`, building a queue around it. */
export function playTrack(index: number): void {
  const { tracks } = useMusic.getState()
  if (!tracks.length) return
  const { shuffle, repeat } = useSettings.getState().settings.music
  failures = 0
  useMusic.setState({ queue: createQueue(tracks.length, { shuffle, repeat, start: index }) })
  startTicking()
  load(true)
}

export function togglePlay(): void {
  const el = audio
  const { current, tracks } = useMusic.getState()
  if (!el || !current) {
    if (tracks.length) playTrack(0)
    return
  }
  startTicking()
  if (el.paused) void el.play().catch(() => {})
  else el.pause()
}

/** Next or previous, because the user asked — see `skip` on repeat-one. */
export function step(direction: 'next' | 'prev'): void {
  const { queue } = useMusic.getState()
  if (!queue) return

  // Two seconds in, Previous means "start this again", which is what every
  // other player does and what the hand expects.
  const el = audio
  if (direction === 'prev' && el && el.currentTime > 2) {
    el.currentTime = 0
    return
  }

  rememberPosition()
  const next = skip(queue, direction)
  if (!next) return stop()
  useMusic.setState({ queue: next })
  load(true)
}

function advance(reason: 'ended'): void {
  const { queue } = useMusic.getState()
  if (!queue) return
  const next = reason === 'ended' ? onTrackEnd(queue) : null
  if (!next) return stop()
  useMusic.setState({ queue: next })
  load(true)
}

export function stop(): void {
  const el = audio
  if (el) {
    el.pause()
    el.removeAttribute('src')
  }
  if (tick) {
    clearInterval(tick)
    tick = null
  }
  useMusic.setState({ playing: false, current: null, position: 0, duration: 0, queue: null })
}

export function seek(seconds: number): void {
  const el = audio
  if (!el || !Number.isFinite(seconds)) return
  el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds))
  useMusic.setState({ position: el.currentTime })
}

export function setVolume(volume: number): void {
  const value = Math.max(0, Math.min(1, volume))
  if (audio) audio.volume = value
  useMusic.setState({ volume: value })
  patchMusic({ volume: value })
}

export function toggleShuffle(): void {
  const { queue } = useMusic.getState()
  const shuffle = !useSettings.getState().settings.music.shuffle
  if (queue) useMusic.setState({ queue: setShuffle(queue, shuffle) })
  patchMusic({ shuffle })
}

/** Off → all → one → off, which is the order every player cycles them in. */
export function cycleRepeat(): void {
  const order: Repeat[] = ['off', 'all', 'one']
  const now = useSettings.getState().settings.music.repeat
  const repeat = order[(order.indexOf(now) + 1) % order.length]
  const { queue } = useMusic.getState()
  if (queue) useMusic.setState({ queue: setRepeat(queue, repeat) })
  patchMusic({ repeat })
}

/* ------------------------------------------------------------ remembering */

/** Merge into the app-level music settings, which is where the player's state lives. */
function patchMusic(patch: Partial<MusicSettings>): void {
  const { settings, patch: apply } = useSettings.getState()
  apply({ music: { ...settings.music, ...patch } })
}

/**
 * Write down where we are.
 *
 * On pause, on a track change, and on the quit flush — and nowhere else. A
 * heartbeat would rewrite the settings file every few seconds for as long as
 * music played, which is a lot of disk to protect against losing a place
 * within one track in a crash.
 */
export function rememberPosition(): void {
  const { current } = useMusic.getState()
  const el = audio
  if (!current || !el) return
  patchMusic({ lastTrack: current.path, lastPosition: Math.floor(el.currentTime) })
}

/**
 * Put the player back where it was, paused.
 *
 * Never autoplays: an app that starts making noise because it was launched is
 * an app people uninstall.
 */
export function restoreLastTrack(tracks: MusicTrack[]): void {
  const { lastTrack, lastPosition, shuffle, repeat } = useSettings.getState().settings.music
  if (!lastTrack) return
  const index = tracks.findIndex((track) => track.path === lastTrack)
  if (index < 0) return
  useMusic.setState({ queue: createQueue(tracks.length, { shuffle, repeat, start: index }) })
  load(false, Math.max(0, lastPosition ?? 0))
}
