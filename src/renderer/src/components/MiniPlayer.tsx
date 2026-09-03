/**
 * The music player, in two sizes off one state.
 *
 * The compact strip lives inside the status bar rather than floating above the
 * workspace, which is what keeps it out of the way of the recording bar and
 * the read-aloud player — both of those are fixed-position pills at the bottom
 * of the window, and a third would have to know about the other two to avoid
 * sitting on them. In the status bar it is simply part of the row.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, parseTrackName, tileInitials, tileSeed } from '@shared/music'
import type { MusicTrack } from '@shared/types'
import {
  cycleRepeat,
  musicUrl,
  playTrack,
  seek,
  setVolume,
  step,
  togglePlay,
  toggleShuffle
} from '@/lib/musicPlayer'
import { useMusic } from '@/store/musicStore'
import { useSettings } from '@/store/settingsStore'
import { Icon } from './Icon'

/** The album a track belongs to, which for a folder of music is its folder. */
function albumOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut).split('/').pop()! : 'Music'
}

/**
 * Artwork, or something deliberate in its place.
 *
 * A picture beside the track when there is one; otherwise a tile coloured from
 * the album's name, so the same record looks the same every launch and the
 * shelf does not read as a row of broken images.
 */
function Art({ track, size }: { track: MusicTrack | null; size: 'sm' | 'lg' }): React.JSX.Element {
  const album = track ? albumOf(track.path) : 'Music'
  if (track?.cover) {
    return (
      <img className={`music-art is-${size}`} src={musicUrl(track.cover)} alt="" aria-hidden="true" />
    )
  }
  return (
    <span
      className={`music-art is-${size} is-generated`}
      data-tile={tileSeed(album)}
      aria-hidden="true"
    >
      {tileInitials(album)}
    </span>
  )
}

function Scrubber({ compact }: { compact?: boolean }): React.JSX.Element {
  const position = useMusic((s) => s.position)
  const duration = useMusic((s) => s.duration)
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0

  return (
    <input
      className={`music-scrub${compact ? ' is-compact' : ''}`}
      type="range"
      min={0}
      max={Math.max(1, Math.floor(duration))}
      value={Math.floor(position)}
      step={1}
      aria-label="Seek"
      style={{ '--music-progress': `${percent}%` } as React.CSSProperties}
      onChange={(e) => seek(Number(e.target.value))}
    />
  )
}

/** How far in, and how long — off the same ticking position the scrubber uses. */
function Elapsed(): React.JSX.Element {
  const position = useMusic((s) => s.position)
  const duration = useMusic((s) => s.duration)
  return (
    <span className="music-elapsed">
      {formatDuration(position)} / {formatDuration(duration)}
    </span>
  )
}

function Transport({ compact }: { compact?: boolean }): React.JSX.Element {
  const playing = useMusic((s) => s.playing)
  const size = compact ? 13 : 16
  return (
    <>
      <button className="icon-btn" aria-label="Previous track" onClick={() => step('prev')}>
        <Icon name="skipBack" size={size} />
      </button>
      <button
        className="icon-btn music-play"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={togglePlay}
      >
        <Icon name={playing ? 'pause' : 'play'} size={size} />
      </button>
      <button className="icon-btn" aria-label="Next track" onClick={() => step('next')}>
        <Icon name="skipForward" size={size} />
      </button>
    </>
  )
}

/** What the library has to say when it has no rows to show. */
function LibraryNotice(): React.JSX.Element | null {
  const library = useMusic((s) => s.library)
  const root = useMusic((s) => s.root)
  const load = useMusic((s) => s.load)

  if (library === 'loading') return <p className="music-notice">Reading the music folder…</p>

  if (library === 'unreachable') {
    // Not a toast and not an empty shelf: an unplugged drive is a cable, and
    // saying which folder is missing is the difference between a fixable
    // problem and an app that appears to have lost the music.
    return (
      <div className="music-notice is-problem">
        <Icon name="info" size={16} />
        <p>
          That music folder cannot be reached right now.
          <code>{root}</code>
          <span>An external drive or a network share that is not mounted looks like this.</span>
        </p>
        <button className="btn btn-small" onClick={() => void load(true)}>
          <Icon name="refresh" size={13} />
          <span>Try again</span>
        </button>
      </div>
    )
  }

  if (library === 'unset') {
    return (
      <p className="music-notice">
        No music folder yet — choose one in Settings, under Music.
      </p>
    )
  }
  return null
}

function Expanded(): React.JSX.Element {
  const tracks = useMusic((s) => s.tracks)
  const current = useMusic((s) => s.current)
  const library = useMusic((s) => s.library)
  const truncated = useMusic((s) => s.truncated)
  const load = useMusic((s) => s.load)
  const setExpanded = useMusic((s) => s.setExpanded)
  const music = useSettings((s) => s.settings.music)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => searchRef.current?.focus(), [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = tracks.map((track, index) => ({ track, index, name: parseTrackName(track.path) }))
    if (!q) return rows.slice(0, 300)
    return rows
      .filter(
        ({ track, name }) =>
          name.title.toLowerCase().includes(q) ||
          (name.artist?.toLowerCase().includes(q) ?? false) ||
          track.path.toLowerCase().includes(q)
      )
      .slice(0, 300)
  }, [tracks, query])

  return (
    <div className="music-panel" role="dialog" aria-label="Music">
      <header className="music-panel-head">
        <Art track={current} size="lg" />
        <div className="music-panel-now">
          <span className="music-title truncate">
            {current ? parseTrackName(current.path).title : 'Nothing playing'}
          </span>
          <span className="music-sub truncate">
            {current ? (parseTrackName(current.path).artist ?? albumOf(current.path)) : ''}
          </span>
          <div className="music-panel-transport">
            <Transport />
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label="Close the player"
          onClick={() => setExpanded(false)}
        >
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className="music-panel-seek">
        <Scrubber />
        <Elapsed />
      </div>

      <div className="music-panel-tools">
        <button
          className={`icon-btn${music.shuffle ? ' is-active' : ''}`}
          aria-pressed={music.shuffle}
          data-tooltip="Shuffle"
          onClick={toggleShuffle}
        >
          <Icon name="shuffle" size={14} />
        </button>
        <button
          className={`icon-btn${music.repeat !== 'off' ? ' is-active' : ''}`}
          aria-label={`Repeat: ${music.repeat}`}
          data-tooltip={`Repeat ${music.repeat}`}
          onClick={cycleRepeat}
        >
          <Icon name="repeat" size={14} />
          {music.repeat === 'one' ? <span className="music-repeat-one">1</span> : null}
        </button>
        <input
          className="music-volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(music.volume * 100)}
          aria-label="Volume"
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
        />
        <input
          ref={searchRef}
          className="music-search"
          type="search"
          placeholder="Search the library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="icon-btn"
          data-tooltip="Read the folder again"
          aria-label="Refresh the library"
          onClick={() => void load(true)}
        >
          <Icon name="download" size={14} />
        </button>
      </div>

      <LibraryNotice />

      {library === 'ready' && !tracks.length ? (
        <p className="music-notice">Nothing playable in that folder yet.</p>
      ) : null}

      <ul className="music-queue">
        {shown.map(({ track, index, name }) => (
          <li key={track.path}>
            <button
              className={`music-row${current?.path === track.path ? ' is-current' : ''}`}
              onClick={() => playTrack(index)}
            >
              <Art track={track} size="sm" />
              <span className="music-row-copy">
                <span className="music-title truncate">{name.title}</span>
                <span className="music-sub truncate">{name.artist ?? albumOf(track.path)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {truncated ? (
        <p className="music-notice">
          Showing the first {tracks.length.toLocaleString()} tracks — the folder holds more.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The strip in the status bar, and the panel it opens.
 *
 * Renders nothing at all until there is a folder to play, so the status bar of
 * someone who does not use this is exactly as it was.
 */
export default function MiniPlayer(): React.JSX.Element | null {
  const folder = useSettings((s) => s.settings.music.folder)
  const expanded = useMusic((s) => s.expanded)
  const current = useMusic((s) => s.current)
  const setExpanded = useMusic((s) => s.setExpanded)
  const load = useMusic((s) => s.load)

  // The folder is read when the player is first opened, and not before.
  useEffect(() => {
    if (expanded) void load()
  }, [expanded, load])

  if (!folder) return null
  const name = current ? parseTrackName(current.path) : null

  return (
    <>
      <div className="music-strip">
        <button
          className="music-strip-open"
          data-tooltip={current ? 'Open the player' : 'Music'}
          aria-label="Open the player"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Art track={current} size="sm" />
          <span className="music-strip-title truncate">{name ? name.title : 'Music'}</span>
        </button>
        <Transport compact />
        <Scrubber compact />
      </div>

      {expanded ? <Expanded /> : null}
    </>
  )
}
