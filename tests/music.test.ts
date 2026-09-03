import { describe, expect, it } from 'vitest'
import {
  coverRank,
  createQueue,
  currentTrack,
  dropTrack,
  formatDuration,
  isAudioPath,
  onTrackEnd,
  parseTrackName,
  setRepeat,
  setShuffle,
  shuffleBag,
  skip,
  tileInitials,
  tileSeed,
  type QueueState,
  type Rng
} from '@shared/music'

/**
 * A deterministic `Math.random` stand-in.
 *
 * The queue's whole contract is about order, so the tests below are only worth
 * anything if the shuffle is repeatable.
 */
const seeded = (seed: number): Rng => {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

/** Play `steps` tracks from `state`, collecting what came out. */
const played = (state: QueueState, steps: number, rng: Rng): number[] => {
  const out: number[] = []
  let at: QueueState | null = state
  for (let i = 0; i < steps && at; i++) {
    const track = currentTrack(at)
    if (track !== null) out.push(track)
    at = onTrackEnd(at, rng)
  }
  return out
}

describe('isAudioPath', () => {
  it('takes the formats the player can actually decode', () => {
    for (const ext of ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'webm']) {
      expect(isAudioPath(`Album/Track.${ext}`)).toBe(true)
    }
  })

  it('is case insensitive', () => {
    expect(isAudioPath('Track.MP3')).toBe(true)
    expect(isAudioPath('Track.FLAC')).toBe(true)
  })

  // Listing one of these would put a row in the library that can only ever
  // fail to play, which reads as a broken player rather than a missing codec.
  it('refuses formats Chromium cannot play', () => {
    expect(isAudioPath('Track.wma')).toBe(false)
    expect(isAudioPath('Track.aiff')).toBe(false)
    expect(isAudioPath('Track.alac')).toBe(false)
  })

  it('refuses everything that is not audio at all', () => {
    expect(isAudioPath('cover.jpg')).toBe(false)
    expect(isAudioPath('notes.md')).toBe(false)
    expect(isAudioPath('Album')).toBe(false)
    expect(isAudioPath('')).toBe(false)
    expect(isAudioPath('.mp3')).toBe(true)
  })
})

describe('coverRank', () => {
  it('prefers cover over folder over album', () => {
    expect(coverRank('cover.jpg')).toBeLessThan(coverRank('folder.jpg'))
    expect(coverRank('folder.png')).toBeLessThan(coverRank('album.png'))
  })

  it('ignores case and takes any ordinary image', () => {
    expect(coverRank('Cover.JPEG')).toBe(0)
    expect(coverRank('COVER.webp')).toBe(0)
  })

  it('is not artwork otherwise', () => {
    expect(coverRank('sleeve.jpg')).toBe(-1)
    expect(coverRank('cover.txt')).toBe(-1)
    expect(coverRank('cover')).toBe(-1)
  })
})

describe('parseTrackName', () => {
  it('reads a track number and a title', () => {
    expect(parseTrackName('01 - Kid A.flac')).toEqual({ track: 1, title: 'Kid A' })
    expect(parseTrackName('07. Idioteque.mp3')).toEqual({ track: 7, title: 'Idioteque' })
    expect(parseTrackName('12_Motion Picture Soundtrack.m4a')).toEqual({
      track: 12,
      title: 'Motion Picture Soundtrack'
    })
  })

  it('reads an artist and a title', () => {
    expect(parseTrackName('Radiohead - Kid A.flac')).toEqual({
      artist: 'Radiohead',
      title: 'Kid A'
    })
  })

  it('reads all three at once', () => {
    expect(parseTrackName('04 - Talk Talk - Ascension Day.mp3')).toEqual({
      track: 4,
      artist: 'Talk Talk',
      title: 'Ascension Day'
    })
  })

  it('keeps a dash that belongs to the title', () => {
    expect(parseTrackName('Godspeed - Storm - Lift Yr Skinny Fists.mp3')).toEqual({
      artist: 'Godspeed',
      title: 'Storm - Lift Yr Skinny Fists'
    })
  })

  // Guessing here would rename the film after its twelfth track.
  it('does not read a leading number that is part of the name', () => {
    expect(parseTrackName('12 Monkeys.mp3')).toEqual({ title: '12 Monkeys' })
    expect(parseTrackName('1984.mp3')).toEqual({ title: '1984' })
  })

  it('falls back to the bare name', () => {
    expect(parseTrackName('Untitled.mp3')).toEqual({ title: 'Untitled' })
    expect(parseTrackName('Albums/Kid A/Everything In Its Right Place.flac').title).toBe(
      'Everything In Its Right Place'
    )
  })

  it('survives a name with nothing in it', () => {
    expect(parseTrackName('.mp3').title).toBe('.mp3')
    expect(parseTrackName('').title).toBe('Untitled')
  })
})

describe('formatDuration', () => {
  it('counts minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(61)).toBe('1:01')
    expect(formatDuration(599)).toBe('9:59')
  })

  it('adds hours once there are any', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('has an answer before a track has loaded', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('tileSeed and tileInitials', () => {
  it('gives one name the same tile every time', () => {
    expect(tileSeed('Kid A')).toBe(tileSeed('Kid A'))
  })

  it('spreads neighbouring names across the buckets', () => {
    const names = ['Kid A', 'Amnesiac', 'In Rainbows', 'Hail to the Thief', 'OK Computer']
    expect(new Set(names.map((n) => tileSeed(n))).size).toBeGreaterThan(1)
  })

  it('stays inside the buckets it was given', () => {
    for (const name of ['', 'a', 'a much longer album name than that one']) {
      expect(tileSeed(name)).toBeGreaterThanOrEqual(0)
      expect(tileSeed(name)).toBeLessThan(5)
    }
  })

  it('draws initials, and something rather than nothing', () => {
    expect(tileInitials('Kid A')).toBe('KA')
    expect(tileInitials('Amnesiac')).toBe('AM')
    expect(tileInitials('!!!')).toBe('♪')
    expect(tileInitials('')).toBe('♪')
  })
})

describe('shuffleBag', () => {
  it('is a permutation, holding every track exactly once', () => {
    const bag = shuffleBag(50, seeded(7))
    expect([...bag].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('has an answer for an empty or single-track library', () => {
    expect(shuffleBag(0, seeded(1))).toEqual([])
    expect(shuffleBag(1, seeded(1))).toEqual([0])
  })
})

describe('the queue, in order', () => {
  it('plays through and stops at the end with repeat off', () => {
    const q = createQueue(3)
    expect(played(q, 5, seeded(1))).toEqual([0, 1, 2])
  })

  it('starts on the track that was asked for', () => {
    expect(currentTrack(createQueue(5, { start: 3 }))).toBe(3)
  })

  it('ignores a start outside the library', () => {
    expect(currentTrack(createQueue(3, { start: 99 }))).toBe(0)
    expect(currentTrack(createQueue(3, { start: -1 }))).toBe(0)
  })

  it('goes round with repeat all', () => {
    const q = createQueue(3, { repeat: 'all' })
    expect(played(q, 7, seeded(1))).toEqual([0, 1, 2, 0, 1, 2, 0])
  })

  it('has nowhere to go from an empty library', () => {
    const q = createQueue(0)
    expect(currentTrack(q)).toBeNull()
    expect(skip(q, 'next')).toBeNull()
    expect(onTrackEnd(q)).toBeNull()
  })
})

describe('the queue, going back', () => {
  it('steps back through what played', () => {
    let q: QueueState | null = createQueue(4)
    q = skip(q!, 'next')
    q = skip(q!, 'next')
    expect(currentTrack(q!)).toBe(2)
    q = skip(q!, 'prev')
    expect(currentTrack(q!)).toBe(1)
  })

  it('stays on the first track rather than stopping', () => {
    // Restarting the track is the player's job; the queue simply has nowhere
    // earlier to be.
    const q = createQueue(3)
    expect(currentTrack(skip(q, 'prev')!)).toBe(0)
  })

  it('wraps to the end when the queue repeats', () => {
    const q = createQueue(3, { repeat: 'all' })
    expect(currentTrack(skip(q, 'prev')!)).toBe(2)
  })

  it('walks back through the shuffled order, not the numeric one', () => {
    const rng = seeded(99)
    let q: QueueState | null = createQueue(8, { shuffle: true, rng })
    const first = currentTrack(q!)
    q = skip(q!, 'next')
    const second = currentTrack(q!)
    q = skip(q!, 'prev')
    expect(currentTrack(q!)).toBe(first)
    expect(second).not.toBe(first)
  })
})

describe('the queue, shuffling', () => {
  it('plays every track once before any plays twice', () => {
    const rng = seeded(4)
    const q = createQueue(12, { shuffle: true, repeat: 'all', rng })
    const bag = played(q, 12, rng)
    expect(new Set(bag).size).toBe(12)
  })

  it('refills with a fresh bag, and every track again', () => {
    const rng = seeded(4)
    const q = createQueue(8, { shuffle: true, repeat: 'all', rng })
    const two = played(q, 16, rng)
    expect(new Set(two.slice(0, 8)).size).toBe(8)
    expect(new Set(two.slice(8)).size).toBe(8)
  })

  // The one place the guarantee is easiest to break, and the most audible: the
  // last track of one bag followed by the first of the next.
  it('does not open a new bag with the track that just finished', () => {
    for (let seed = 1; seed < 40; seed++) {
      const rng = seeded(seed)
      const q = createQueue(6, { shuffle: true, repeat: 'all', rng })
      const run = played(q, 13, rng)
      for (let i = 1; i < run.length; i++) expect(run[i]).not.toBe(run[i - 1])
    }
  })

  it('still starts on the track that was asked for', () => {
    const q = createQueue(20, { shuffle: true, start: 11, rng: seeded(3) })
    expect(currentTrack(q)).toBe(11)
  })

  it('stops at the end of the bag when repeat is off', () => {
    const rng = seeded(5)
    const q = createQueue(4, { shuffle: true, rng })
    expect(played(q, 9, rng)).toHaveLength(4)
  })
})

describe('the queue, changing its mind', () => {
  it('keeps playing the same track when shuffle goes on', () => {
    let q: QueueState | null = createQueue(10, { start: 6 })
    q = skip(q!, 'next')
    const before = currentTrack(q!)
    const after = setShuffle(q!, true, seeded(2))
    expect(currentTrack(after)).toBe(before)
    expect(after.shuffle).toBe(true)
  })

  it('keeps playing the same track when shuffle goes off', () => {
    const q = createQueue(10, { shuffle: true, start: 4, rng: seeded(8) })
    const after = setShuffle(q, false, seeded(8))
    expect(currentTrack(after)).toBe(4)
    expect(after.order).toEqual(Array.from({ length: 10 }, (_, i) => i))
  })

  it('leaves the rest of the bag unheard when shuffle goes on mid-queue', () => {
    const rng = seeded(12)
    let q: QueueState | null = createQueue(9, { repeat: 'all' })
    q = skip(q!, 'next')
    const shuffled = setShuffle(q!, true, rng)
    const run = played(shuffled, 9, rng)
    expect(new Set(run).size).toBe(9)
  })

  it('does nothing when shuffle is set to what it already is', () => {
    const q = createQueue(5, { shuffle: true, rng: seeded(1) })
    expect(setShuffle(q, true, seeded(2))).toBe(q)
  })
})

describe('the queue, repeating one', () => {
  it('plays the same track again when it ends on its own', () => {
    const q = setRepeat(createQueue(5, { start: 2 }), 'one')
    expect(played(q, 4, seeded(1))).toEqual([2, 2, 2, 2])
  })

  // Repeat-one that Next cannot escape is a trap, not a feature.
  it('moves on when the user presses next', () => {
    const q = setRepeat(createQueue(5, { start: 2 }), 'one')
    expect(currentTrack(skip(q, 'next')!)).toBe(3)
    expect(currentTrack(skip(q, 'prev')!)).toBe(1)
  })

  it('is left as it was by setting the repeat it already has', () => {
    const q = createQueue(3, { repeat: 'all' })
    expect(setRepeat(q, 'all')).toBe(q)
  })
})

describe('dropTrack', () => {
  it('forgets a track that has gone, and closes the gap', () => {
    const q = createQueue(5)
    const after = dropTrack(q, 2)
    expect(after.order).toEqual([0, 1, 2, 3])
    expect(after.order).toHaveLength(4)
  })

  it('keeps playing what was playing when a later track goes', () => {
    let q: QueueState | null = createQueue(5)
    q = skip(q!, 'next')
    expect(currentTrack(dropTrack(q!, 4))).toBe(1)
  })

  it('shifts the cursor when an earlier track goes', () => {
    let q: QueueState | null = createQueue(5)
    q = skip(q!, 'next')
    q = skip(q!, 'next')
    expect(currentTrack(q!)).toBe(2)
    // Track 0 is gone, so what was 2 is now 1 — and still what is playing.
    expect(currentTrack(dropTrack(q!, 0))).toBe(1)
  })

  it('survives dropping the last track in the library', () => {
    const after = dropTrack(createQueue(1), 0)
    expect(after.order).toEqual([])
    expect(currentTrack(after)).toBeNull()
  })
})
