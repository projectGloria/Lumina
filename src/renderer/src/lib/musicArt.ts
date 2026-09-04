/**
 * Cover art, asked for once per track and remembered.
 *
 * Extraction is main-side and costs a file parse, so the rule is that a track's
 * art is only ever requested when that track is on screen — `Art` in
 * `MiniPlayer` watches with an `IntersectionObserver` rather than firing for
 * every row in the list. This is the bookkeeping that keeps a second look free.
 */

/** Resolved answers: a `lumina://art/...` URL, or null for a file with none. */
const known = new Map<string, string | null>()

/** Lookups in flight, so two rows drawn at once ask main once. */
const asking = new Map<string, Promise<string | null>>()

/** What is already known, without asking. Undefined means "not looked up yet". */
export function knownArt(path: string): string | null | undefined {
  return known.get(path)
}

export function trackArt(path: string): Promise<string | null> {
  const cached = known.get(path)
  if (cached !== undefined) return Promise.resolve(cached)

  const running = asking.get(path)
  if (running) return running

  const work = window.lumina.music
    .art(path)
    .catch(() => null)
    .then((url) => {
      known.set(path, url)
      return url
    })
    .finally(() => asking.delete(path))

  asking.set(path, work)
  return work
}

/** A new music folder means the old answers are about files nobody is asking about. */
export function forgetArt(): void {
  known.clear()
  asking.clear()
}
