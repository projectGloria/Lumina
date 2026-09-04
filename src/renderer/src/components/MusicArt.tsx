import { useEffect, useRef, useState } from 'react'
import { tileInitials, tileSeed } from '@shared/music'
import type { MusicTrack } from '@shared/types'
import { knownArt, trackArt } from '@/lib/musicArt'
import { musicUrl } from '@/lib/musicPlayer'

/** The album a track belongs to, which for a folder of music is its folder. */
export function albumOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut).split('/').pop()! : 'Music'
}

/**
 * A track's cover, in three descending degrees of truth.
 *
 * 1. What the file's own tags carry, which is the only thing that describes
 *    *this track*.
 * 2. The `cover.jpg` beside it, which describes its folder — right for an
 *    album, and in a mixed folder it puts one record's sleeve on a dozen
 *    unrelated tracks.
 * 3. A tile coloured and lettered from the folder's name, which claims
 *    nothing.
 *
 * The picture is a background rather than an `<img>` so the element the
 * observer watches is the same one either way — and so a source that fails to
 * load reveals the tile underneath instead of a broken image.
 */
export default function MusicArt({
  track,
  size,
  className
}: {
  track: MusicTrack | null
  size: 'sm' | 'lg'
  className?: string
}): React.JSX.Element {
  const album = track ? albumOf(track.path) : 'Music'
  const path = track?.path
  const [embedded, setEmbedded] = useState<string | null | undefined>(() =>
    path ? knownArt(path) : undefined
  )
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!path) {
      setEmbedded(undefined)
      return
    }

    const already = knownArt(path)
    if (already !== undefined) {
      setEmbedded(already)
      return
    }
    setEmbedded(undefined)

    const el = ref.current
    if (!el) return

    /*
     * Only a track that is actually on screen costs a parse in the main
     * process. The queue list can hold hundreds of rows, and extracting art
     * for all of them the moment the panel opens is precisely the "not all
     * 20,000" this is supposed to avoid.
     */
    let live = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void trackArt(path).then((url) => {
        if (live) setEmbedded(url)
      })
    })
    observer.observe(el)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [path])

  const src = embedded ?? (track?.cover ? musicUrl(track.cover) : null)

  return (
    <span
      ref={ref}
      className={`music-art is-${size}${src ? ' has-image' : ''}${className ? ` ${className}` : ''}`}
      data-tile={tileSeed(album)}
      style={src ? { backgroundImage: `url("${src}")` } : undefined}
      aria-hidden="true"
    >
      {tileInitials(album)}
    </span>
  )
}
