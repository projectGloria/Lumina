/**
 * Making sense of a widget's stored options.
 *
 * `home.json` is a plain file a user can edit, and a board also outlives the
 * build that wrote it — so a widget's `config` may hold the wrong type for a
 * key, be missing one the widget now reads, or carry one from a version that
 * knew more. `normalizeLayout` handles the file's shape; this handles what is
 * inside a widget, and it is the reason a typo cannot make a widget render
 * `repeat(NaN, 1fr)` or a list that is empty for no visible reason.
 */

/** Same primitive kind, which is all the defaults can tell us. */
function sameShape(value: unknown, fallback: unknown): boolean {
  if (typeof value !== typeof fallback) return false
  // A number that is not a number is the case this exists for: `Number("many")`
  // reaches the widget as NaN and every comparison it feeds goes quiet.
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(fallback)) return Array.isArray(value)
  if (fallback !== null && typeof fallback === 'object') {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }
  return true
}

/**
 * A widget's options: the definition's defaults, with anything usable from the
 * stored config laid over them.
 *
 * Keys the defaults do not mention are dropped **here, on the way to the
 * component** — never from what is stored. A board written by a later build
 * still round-trips its own keys through this one, which is the same courtesy
 * `normalizeLayout` extends to a widget type it does not recognise.
 */
export function mergeWidgetConfig<C extends Record<string, unknown>>(
  defaults: C,
  stored: Record<string, unknown> | undefined
): C {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...defaults }

  const merged: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(defaults)) {
    if (!(key in stored)) continue
    const value = stored[key]
    if (sameShape(value, defaults[key])) merged[key] = value
  }
  return merged as C
}

/**
 * One of `allowed`, or the default.
 *
 * A string default cannot say which strings are meaningful, so a widget whose
 * option is a fixed set of words checks it here rather than falling through to
 * whichever branch its `===` happens to miss.
 */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}
