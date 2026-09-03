import { useEffect } from 'react'
import { parseTrackName, tileInitials, tileSeed } from '@shared/music'
import { Icon } from '@/components/Icon'
import { musicUrl, playTrack, step, togglePlay } from '@/lib/musicPlayer'
import { useMusic } from '@/store/musicStore'
import { useSettings } from '@/store/settingsStore'
import { EmptyCard, LoadingCard } from './CardState'
import { defineWidget } from './types'

/**
 * What is playing, on the board.
 *
 * The same store the status-bar strip draws from — this is a second view of
 * one player, not a second player. Mounting it is one of the two things that
 * reads the music folder, the other being opening the panel; nothing about
 * music runs at startup.
 */
function Music(): React.JSX.Element {
  const folder = useSettings((s) => s.settings.music.folder)
  const library = useMusic((s) => s.library)
  const tracks = useMusic((s) => s.tracks)
  const current = useMusic((s) => s.current)
  const playing = useMusic((s) => s.playing)
  const setExpanded = useMusic((s) => s.setExpanded)
  const load = useMusic((s) => s.load)

  useEffect(() => {
    if (folder) void load()
  }, [folder, load])

  if (!folder) {
    return (
      <EmptyCard
        icon="speaker"
        line="No music folder yet."
        action={{ label: 'Choose one', icon: 'folder', onSelect: () => runSettings() }}
      />
    )
  }
  if (library === 'loading' || library === 'idle') return <LoadingCard rows={2} />
  if (library === 'unreachable') {
    return <EmptyCard icon="info" line="That music folder cannot be reached right now." />
  }
  if (!tracks.length) return <EmptyCard icon="speaker" line="Nothing playable in that folder." />

  const name = current ? parseTrackName(current.path) : null
  const album = current ? (current.path.split('/').slice(-2)[0] ?? 'Music') : 'Music'

  return (
    <div className="home-music">
      <button
        className="home-music-art"
        aria-label="Open the player"
        onClick={() => setExpanded(true)}
      >
        {current?.cover ? (
          <img src={musicUrl(current.cover)} alt="" />
        ) : (
          <span className="music-art is-generated is-lg" data-tile={tileSeed(album)}>
            {tileInitials(album)}
          </span>
        )}
      </button>
      <div className="home-music-copy">
        <span className="home-music-title truncate">{name ? name.title : 'Nothing playing'}</span>
        <span className="home-music-sub truncate">
          {name ? (name.artist ?? album) : `${tracks.length.toLocaleString()} tracks`}
        </span>
        <div className="home-music-transport">
          <button className="icon-btn" aria-label="Previous track" onClick={() => step('prev')}>
            <Icon name="skipBack" size={15} />
          </button>
          <button
            className="icon-btn"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => (current ? togglePlay() : playTrack(0))}
          >
            <Icon name={playing ? 'pause' : 'play'} size={17} />
          </button>
          <button className="icon-btn" aria-label="Next track" onClick={() => step('next')}>
            <Icon name="skipForward" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Deferred so this widget does not import the command registry at module scope. */
function runSettings(): void {
  void import('@/store/uiStore').then(({ useUi }) => useUi.getState().openSettings())
}

export const musicWidget = defineWidget<Record<string, unknown>>({
  type: 'music',
  name: 'Music',
  description: 'What is playing, from your own music folder',
  icon: 'speaker',
  defaultSize: { w: 2, h: 1 },
  minSize: { w: 1, h: 1 },
  defaultConfig: {},
  accent: 'quiet',
  Component: Music
})
