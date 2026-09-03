import { describe, expect, it } from 'vitest'
import {
  TASK_HOLD_MS,
  drop,
  nextFrozenOrder,
  nextTickDeadline,
  parseTaskKey,
  reconcileTicks,
  taskKey,
  taskView,
  tick,
  type TaskRow,
  type TaskTicks
} from '@shared/homeTasks'

const row = (path: string, line: number, text: string, done = false, mtime = 0): TaskRow => ({
  path,
  line,
  text,
  done,
  mtime
})

const view = (rows: TaskRow[], over: Partial<Parameters<typeof taskView>[1]> = {}): string[] =>
  taskView(rows, { showDone: false, ticks: {}, frozen: null, limit: 20, ...over }).map((r) => r.text)

describe('taskKey', () => {
  it('round-trips a plain path', () => {
    expect(parseTaskKey(taskKey('Notes/Todo.md', 4))).toEqual({ path: 'Notes/Todo.md', line: 4 })
  })

  // The split is on the last colon, so a note whose own name contains one is
  // the case worth pinning: the appended line number is always last.
  it('round-trips a path with a colon in the filename', () => {
    expect(parseTaskKey(taskKey('Notes/Chapter: One.md', 12))).toEqual({
      path: 'Notes/Chapter: One.md',
      line: 12
    })
  })

  it('round-trips a path with several colons and a zero line', () => {
    expect(parseTaskKey(taskKey('a:b/c: d:e.md', 0))).toEqual({ path: 'a:b/c: d:e.md', line: 0 })
  })

  it('refuses a key that names no line', () => {
    expect(parseTaskKey('Notes/Todo.md')).toBeNull()
    expect(parseTaskKey('Notes/Todo.md:')).toBeNull()
    expect(parseTaskKey('Notes/Todo.md:four')).toBeNull()
    expect(parseTaskKey('Notes/Todo.md:-1')).toBeNull()
    expect(parseTaskKey(':4')).toBeNull()
  })
})

describe('taskView', () => {
  it('hides finished tasks by default and shows them on request', () => {
    const rows = [row('a.md', 0, 'open'), row('a.md', 1, 'closed', true)]
    expect(view(rows)).toEqual(['open'])
    expect(view(rows, { showDone: true })).toEqual(['open', 'closed'])
  })

  it('skips a checkbox with no text at all', () => {
    expect(view([row('a.md', 0, ''), row('a.md', 1, 'real')])).toEqual(['real'])
  })

  it('orders by mtime, newest note first', () => {
    const rows = [row('old.md', 0, 'old', false, 10), row('new.md', 0, 'new', false, 20)]
    expect(view(rows)).toEqual(['new', 'old'])
  })

  it('orders two tasks in one note by line', () => {
    const rows = [row('a.md', 3, 'later', false, 10), row('a.md', 1, 'earlier', false, 10)]
    expect(view(rows)).toEqual(['earlier', 'later'])
  })

  // The bug this exists for: the optimistic tick landed, the row was filtered
  // out by `showDone` on the same click, and the task appeared to be deleted.
  it('keeps a task ticked here on the board, drawn as done', () => {
    const rows = [row('a.md', 0, 'buy milk')]
    const ticks = tick({}, taskKey('a.md', 0), true, 1000)
    const [held] = taskView(rows, { showDone: false, ticks, frozen: null, limit: 20 })
    expect(held).toMatchObject({ text: 'buy milk', done: true, held: true })
  })

  it('still keeps it once the index agrees the task is done', () => {
    const ticks = reconcileTicks(
      tick({}, taskKey('a.md', 0), true, 1000),
      [row('a.md', 0, 'buy milk', true)],
      1100
    ).next
    expect(view([row('a.md', 0, 'buy milk', true)], { ticks })).toEqual(['buy milk'])
  })

  it('drops it again the moment it is unticked', () => {
    let ticks = tick({}, taskKey('a.md', 0), true, 1000)
    ticks = drop(ticks, taskKey('a.md', 0))
    expect(taskView([row('a.md', 0, 'buy milk', true)], {
      showDone: false,
      ticks,
      frozen: null,
      limit: 20
    })).toEqual([])
  })

  it('shows the optimistic value while a write is in flight', () => {
    const ticks = tick({}, taskKey('a.md', 0), false, 1000)
    const [only] = taskView([row('a.md', 0, 'undo me', true)], {
      showDone: true,
      ticks,
      frozen: null,
      limit: 20
    })
    expect(only).toMatchObject({ done: false, held: false })
  })

  it('holds the order against the mtime bump a tick causes', () => {
    const before = [row('a.md', 0, 'first', false, 10), row('b.md', 0, 'second', false, 5)]
    const frozen = taskView(before, {
      showDone: false,
      ticks: {},
      frozen: null,
      limit: 20
    }).map((r) => r.key)

    // The write lands: b.md is rewritten, so it now has the newest mtime and
    // would otherwise jump over a.md while the pointer is still on it.
    const after = [row('a.md', 0, 'first', false, 10), row('b.md', 0, 'second', true, 99)]
    const ticks = tick({}, taskKey('b.md', 0), true, 1000)
    expect(view(after, { ticks, frozen })).toEqual(['first', 'second'])
    expect(view(after, { ticks, frozen: null })).toEqual(['second', 'first'])
  })

  it('puts a task the freeze never saw after the ones it did', () => {
    const frozen = [taskKey('a.md', 0)]
    const rows = [row('a.md', 0, 'known', false, 1), row('b.md', 0, 'new', false, 99)]
    expect(view(rows, { frozen })).toEqual(['known', 'new'])
  })

  it('respects the limit, and survives a nonsense one', () => {
    const rows = [row('a.md', 0, 'one', false, 3), row('a.md', 1, 'two', false, 3)]
    expect(view(rows, { limit: 1 })).toEqual(['one'])
    expect(view(rows, { limit: Number.NaN })).toEqual(['one'])
    expect(view(rows, { limit: 0 })).toEqual(['one'])
  })
})

describe('reconcileTicks', () => {
  const key = taskKey('a.md', 0)

  it('marks a tick settled once the index agrees, keeping the hold', () => {
    const { next, changed } = reconcileTicks(
      tick({}, key, true, 1000),
      [row('a.md', 0, 'x', true)],
      1100
    )
    expect(changed).toBe(true)
    expect(next[key]).toMatchObject({ done: true, pending: false })
  })

  it('waits while the index still disagrees', () => {
    const ticks = tick({}, key, true, 1000)
    const { next, changed } = reconcileTicks(ticks, [row('a.md', 0, 'x', false)], 1100)
    expect(changed).toBe(false)
    expect(next).toBe(ticks)
  })

  it('forgets a settled untick rather than holding it', () => {
    const { next } = reconcileTicks(tick({}, key, false, 1000), [row('a.md', 0, 'x')], 1100)
    expect(next).toEqual({})
  })

  // A note deleted between the click and the round trip used to leave an
  // entry nothing could ever settle, for the life of the session.
  it('expires an entry the index never confirms', () => {
    const ticks = tick({}, key, true, 1000)
    expect(reconcileTicks(ticks, [], 1100).next[key]).toBeDefined()
    expect(reconcileTicks(ticks, [], 1000 + TASK_HOLD_MS).next).toEqual({})
  })

  it('expires a hold that has been shown for long enough', () => {
    const settled: TaskTicks = { [key]: { done: true, at: 1000, pending: false } }
    expect(reconcileTicks(settled, [row('a.md', 0, 'x', true)], 1000 + TASK_HOLD_MS).next).toEqual(
      {}
    )
  })

  it('expires a write that silently never happened', () => {
    const ticks = tick({}, key, true, 1000)
    const { next } = reconcileTicks(ticks, [row('a.md', 0, 'x', false)], 1000 + TASK_HOLD_MS)
    expect(next).toEqual({})
  })
})

describe('nextFrozenOrder', () => {
  const rows = [row('a.md', 0, 'one', false, 2), row('b.md', 0, 'two', false, 1)]
  const current = taskView(rows, { showDone: false, ticks: {}, frozen: null, limit: 20 })

  it('freezes what is on screen when the first tick starts', () => {
    const ticks = tick({}, taskKey('a.md', 0), true, 1000)
    expect(nextFrozenOrder(null, current, ticks)).toEqual([
      taskKey('a.md', 0),
      taskKey('b.md', 0)
    ])
  })

  it('keeps the first freeze while further ticks come in', () => {
    const frozen = [taskKey('b.md', 0)]
    const ticks = tick({}, taskKey('a.md', 0), true, 1000)
    expect(nextFrozenOrder(frozen, current, ticks)).toBe(frozen)
  })

  it('releases the order once nothing is outstanding', () => {
    expect(nextFrozenOrder([taskKey('a.md', 0)], current, {})).toBeNull()
  })
})

describe('nextTickDeadline', () => {
  it('is the earliest expiry among the outstanding entries', () => {
    const ticks = tick(tick({}, 'a.md:0', true, 5000), 'b.md:0', true, 1000)
    expect(nextTickDeadline(ticks)).toBe(1000 + TASK_HOLD_MS)
  })

  it('is null when there is nothing to wait for', () => {
    expect(nextTickDeadline({})).toBeNull()
  })
})
