const pending = new Set<Promise<unknown>>()

/** Work that may still create or edit a note must settle before a vault leaves. */
export function trackWork<A extends unknown[], R>(operation: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => {
    const result = operation(...args)
    pending.add(result)
    void result.finally(() => pending.delete(result)).catch(() => {})
    return result
  }
}

export async function flushPendingWork(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending])
}
