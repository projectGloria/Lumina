/**
 * The music player's rules, with no audio element and no filesystem in sight.
 *
 * A queue is the part of a player people notice when it is wrong — a shuffle
 * that plays the same song twice before touching half the album, a Next that
 * does nothing on the last track, a repeat-one that cannot be escaped. All of
 * that is decided here, as transitions over a plain object, so
 * `tests/music.test.ts` can hold it still.
 */

/* ------------------------------------------------------------------ files */

/**
 * Extensions the player will list.
 *
 * Deliberately only what Chromium can decode: listing a `.wma` that can never
 * play is worse than not listing it, because the failure arrives later and
 * looks like a broken player rather than an unsupported file.
 */
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'webm'])

export function isAudioPath(value: string): boolean {
  const ext = value.slice(value.lastIndexOf('.') + 1).toLowerCase()
  return value.includes('.') && AUDIO_EXTENSIONS.has(ext)
}

/** Names a cover picture sitting beside the tracks, in the order preferred. */
const COVER_STEMS = ['cover', 'folder', 'album', 'front']
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])

/** Where in `COVER_STEMS` this file ranks, or -1 when it is not artwork. */
export function coverRank(filename: string): number {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return -1
  const ext = filename.slice(dot + 1).toLowerCase()
  if (!COVER_EXTENSIONS.has(ext)) return -1
  return COVER_STEMS.indexOf(filename.slice(0, dot).toLowerCase())
}

/* ------------------------------------------------------------------ names */

export interface TrackName {
  title: string
  artist?: string
  track?: number
}

/** `…/01 - Song.mp3` → `01 - Song`. */
function stem(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * What a filename says about the track.
 *
 * Only separators that cannot be part of an ordinary title count as a track
 * number: `01 - `, `01. `, `01_`. A bare `12 Monkeys` keeps its name, because
 * guessing there would rename the film after its twelfth track.
 */
export function parseTrackName(path: string): TrackName {
  let rest = stem(path).trim()
  let track: number | undefined

  const numbered = rest.match(/^(\d{1,3})\s*[-._]\s*(.+)$/)
  if (numbered) {
    track = Number(numbered[1])
    rest = numbered[2].trim()
  }

  // `Artist - Title`, on the first separator only: a title with a dash of its
  // own keeps it, which is commoner than a two-dash artist.
  const split = rest.split(/\s+-\s+/)
  if (split.length > 1 && split[0].trim()) {
    const artist = split[0].trim()
    const title = split.slice(1).join(' - ').trim()
    if (title) return track === undefined ? { title, artist } : { title, artist, track }
  }

  const title = rest || stem(path) || 'Untitled'
  return track === undefined ? { title } : { title, track }
}

/** `m:ss`, or `h:mm:ss` once there is an hour to show. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * A stable number for a name, for the generated artwork tile.
 *
 * The same album gets the same colour every launch, and neighbouring albums
 * get different ones — which is the whole job of a tile that stands in for a
 * picture. Not a hash anyone should rely on for anything else.
 */
export function tileSeed(name: string, buckets = 5): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return Math.abs(hash) % Math.max(1, buckets)
}

/** One or two letters to put on that tile. */
export function tileInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return '♪'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/* ------------------------------------------------------------------ queue */

export type Repeat = 'off' | 'all' | 'one'

export interface QueueState {
  /**
   * Library indices in the order they will play.
   *
   * With shuffle on this is a *bag*: a permutation consumed to exhaustion, so
   * every track plays once before any plays twice. A player that picked at
   * random each time would replay a track while a third of the album had not
   * been heard, which is the thing people mean when they say shuffle is broken.
   */
  order: number[]
  /** Position within `order`. */
  cursor: number
  repeat: Repeat
  shuffle: boolean
}

/** `Math.random`, unless a test wants to know what comes next. */
export type Rng = () => number

/** A Fisher-Yates permutation of `0..count-1`. */
export function shuffleBag(count: number, rng: Rng = Math.random): number[] {
  const bag = Array.from({ length: Math.max(0, count) }, (_, i) => i)
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

/**
 * A fresh bag that does not open with `avoid`.
 *
 * Without this the guarantee breaks exactly where it is most noticeable: the
 * last track of one bag followed by the first of the next, the same song twice
 * in a row having just promised it would not be.
 */
function refill(count: number, avoid: number | null, shuffle: boolean, rng: Rng): number[] {
  const order = shuffle ? shuffleBag(count, rng) : Array.from({ length: count }, (_, i) => i)
  if (shuffle && order.length > 1 && avoid !== null && order[0] === avoid) {
    ;[order[0], order[1]] = [order[1], order[0]]
  }
  return order
}

export interface QueueOptions {
  shuffle?: boolean
  repeat?: Repeat
  /** Library index to start on. Anything out of range starts at the beginning. */
  start?: number
  rng?: Rng
}

export function createQueue(count: number, options: QueueOptions = {}): QueueState {
  const { shuffle = false, repeat = 'off', start = 0, rng = Math.random } = options
  const order = shuffle ? shuffleBag(count, rng) : Array.from({ length: count }, (_, i) => i)
  const wanted = Number.isInteger(start) && start >= 0 && start < count ? start : null
  if (wanted === null) return { order, cursor: order.length ? 0 : -1, repeat, shuffle }

  if (!shuffle) {
    // In order, starting at track three means the cursor is at track three —
    // moving it to the front instead would make Next play track two, with the
    // album resequenced around wherever the user happened to start.
    return { order, cursor: wanted, repeat, shuffle }
  }

  // In a bag, the track asked for is moved to the front, so what remains of
  // the bag behind it is exactly what has not been heard yet.
  const at = order.indexOf(wanted)
  if (at > 0) [order[0], order[at]] = [order[at], order[0]]
  return { order, cursor: 0, repeat, shuffle }
}

/** The library index playing now, or null for an empty queue. */
export function currentTrack(state: QueueState): number | null {
  return state.cursor >= 0 && state.cursor < state.order.length ? state.order[state.cursor] : null
}

/**
 * Next or previous, because the user asked.
 *
 * `repeat: 'one'` is deliberately ignored here: pressing Next on a track set to
 * repeat means "I am done with this one", and a player that answers by playing
 * it again is one nobody can escape. Only `onTrackEnd` honours it.
 *
 * Returns null when there is nowhere to go, which the caller draws as stopping.
 */
export function skip(state: QueueState, direction: 'next' | 'prev', rng: Rng = Math.random): QueueState | null {
  if (!state.order.length) return null
  const last = currentTrack(state)

  if (direction === 'prev') {
    if (state.cursor > 0) return { ...state, cursor: state.cursor - 1 }
    // Only a repeating queue has anything before its first track.
    if (state.repeat === 'off') return { ...state, cursor: 0 }
    return { ...state, cursor: state.order.length - 1 }
  }

  if (state.cursor + 1 < state.order.length) return { ...state, cursor: state.cursor + 1 }
  if (state.repeat === 'off') return null
  return { ...state, order: refill(state.order.length, last, state.shuffle, rng), cursor: 0 }
}

/**
 * What follows when a track runs out on its own.
 *
 * The one place `repeat: 'one'` acts, and the reason it is separate from
 * `skip`.
 */
export function onTrackEnd(state: QueueState, rng: Rng = Math.random): QueueState | null {
  if (state.repeat === 'one' && currentTrack(state) !== null) return state
  return skip(state, 'next', rng)
}

/**
 * Turn shuffle on or off without changing what is playing.
 *
 * The track under the needle stays under the needle — switching to shuffle
 * mid-song and being thrown to a different one is the kind of thing that makes
 * a person stop trusting the button.
 */
export function setShuffle(state: QueueState, shuffle: boolean, rng: Rng = Math.random): QueueState {
  if (shuffle === state.shuffle) return state
  const count = state.order.length
  const playing = currentTrack(state)
  const order = shuffle ? shuffleBag(count, rng) : Array.from({ length: count }, (_, i) => i)

  if (playing === null) return { ...state, order, cursor: count ? 0 : -1, shuffle }
  const at = order.indexOf(playing)
  if (shuffle) {
    // A new bag, with the current track moved to the front so the rest of it
    // is what has not been heard yet.
    if (at > 0) [order[0], order[at]] = [order[at], order[0]]
    return { ...state, order, cursor: 0, shuffle }
  }
  // In order, the cursor is simply where that track sits.
  return { ...state, order, cursor: Math.max(0, at), shuffle }
}

export function setRepeat(state: QueueState, repeat: Repeat): QueueState {
  return state.repeat === repeat ? state : { ...state, repeat }
}

/**
 * Drop a track that has gone from the library.
 *
 * A file can be deleted or unplugged while it sits in the queue; the player
 * skips past it, and the queue should stop offering it. Indices above it shift
 * down, since the library array has closed the gap.
 */
export function dropTrack(state: QueueState, index: number): QueueState {
  const order = state.order
    .filter((i) => i !== index)
    .map((i) => (i > index ? i - 1 : i))
  const removedBefore = state.order.slice(0, state.cursor).filter((i) => i === index).length
  return { ...state, order, cursor: Math.min(Math.max(0, state.cursor - removedBefore), Math.max(0, order.length - 1)) }
}
