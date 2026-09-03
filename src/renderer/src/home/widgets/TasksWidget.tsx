import { useEffect, useMemo, useState } from 'react'
import { findTaskLine, isPathAtOrBelow, setTaskDone, toPlainText } from '@shared/markdown-parse'
import {
  drop,
  nextFrozenOrder,
  nextTickDeadline,
  reconcileTicks,
  taskView,
  tick,
  type TaskRow,
  type TaskTicks,
  type TaskViewRow
} from '@shared/homeTasks'
import { openNote, updateNoteContent } from '@/lib/actions'
import { toast } from '@/store/uiStore'
import { titleOf, useVault } from '@/store/vaultStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface TasksConfig extends Record<string, unknown> {
  count: number
  /** Vault-relative folder to limit the list to; empty means the whole vault. */
  folder: string
  showDone: boolean
}

/**
 * Open checkboxes from across the vault, tickable in place.
 *
 * Everything about which rows show and in what order is in
 * `@shared/homeTasks`; this draws the result and owns the round trip. Two of
 * those rules exist because of how the round trip feels: a box ticked here
 * stays on the board rather than being filtered away by the same click, and
 * the order is held still while the write bumps the note's mtime.
 */
function Tasks({ config }: WidgetProps<TasksConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)
  /** Boxes ticked here, from the click until the board stops holding them. */
  const [ticks, setTicks] = useState<TaskTicks>({})
  const [frozen, setFrozen] = useState<string[] | null>(null)

  /** Every task in scope — reconciliation needs the finished ones too. */
  const rows = useMemo<TaskRow[]>(() => {
    const out: TaskRow[] = []
    for (const note of Object.values(index.notes)) {
      if (config.folder && !isPathAtOrBelow(note.path, config.folder)) continue
      for (const task of note.tasks) {
        out.push({
          path: note.path,
          line: task.line,
          text: task.text,
          done: task.done,
          mtime: note.mtime
        })
      }
    }
    return out
  }, [index, config.folder])

  const tasks = useMemo(
    () => taskView(rows, { showDone: config.showDone, ticks, frozen, limit: config.count }),
    [rows, config.showDone, config.count, ticks, frozen]
  )

  // Settle what the index has caught up with, and expire what it never will.
  useEffect(() => {
    setTicks((current) => reconcileTicks(current, rows, Date.now()).next)
  }, [rows])

  // The last entry's expiry is not an index event, so it needs its own clock —
  // otherwise a hold with nothing else happening in the vault never ends.
  useEffect(() => {
    const deadline = nextTickDeadline(ticks)
    if (deadline === null) return
    const timer = setTimeout(
      () => setTicks((current) => reconcileTicks(current, rows, Date.now()).next),
      Math.max(0, deadline - Date.now())
    )
    return () => clearTimeout(timer)
  }, [ticks, rows])

  // Hold the order while anything is settling. Captured from what is on screen
  // at the first click, released when the last entry goes.
  useEffect(() => {
    setFrozen((current) => nextFrozenOrder(current, tasks, ticks))
  }, [ticks, tasks])

  const toggle = async (task: TaskViewRow, done: boolean): Promise<void> => {
    setTicks((current) => tick(current, task.key, done, Date.now()))

    let applied = false
    const ok = await updateNoteContent(task.path, (content) => {
      // The line comes from the index, the content may be ahead of it: a note
      // open in a tab with unsaved edits has already moved the task. Its own
      // text is what identifies it.
      const line = findTaskLine(content, task.line, task.text)
      if (line === null) return content
      const next = setTaskDone(content, line, done)
      applied = next !== null
      return next ?? content
    })

    if (ok && applied) return
    setTicks((current) => drop(current, task.key))
    // Either the task is gone, or there are two of it and the same distance
    // from where it was — both are cases for the note rather than a guess.
    if (ok) toast('That task has moved — open the note to change it', 'error')
  }

  if (!tasks.length) {
    return (
      <p className="home-widget-empty">
        {config.showDone ? 'No tasks in this vault yet.' : 'Nothing outstanding.'}
      </p>
    )
  }

  return (
    <ul className="home-list home-tasks">
      {tasks.map((task) => {
        const label = toPlainText(task.text)
        return (
          <li
            key={task.key}
            className={`home-task${task.done ? ' is-done' : ''}${task.held ? ' is-held' : ''}`}
          >
            <input
              type="checkbox"
              className="home-task-box"
              checked={task.done}
              aria-label={label}
              onChange={(e) => void toggle(task, e.target.checked)}
            />
            <button
              className="home-task-text truncate"
              data-tooltip={`${task.path}:${task.line + 1}`}
              onClick={() => openNote(task.path, { line: task.line })}
            >
              {label}
            </button>
            <span className="home-row-meta truncate">{titleOf(task.path)}</span>
            {task.held ? (
              <button
                className="home-task-undo"
                aria-label={`Undo completing ${label}`}
                onClick={() => void toggle(task, false)}
              >
                Undo
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function TasksSettings({ config, setConfig }: WidgetSettingsProps<TasksConfig>): React.JSX.Element {
  return (
    <>
      <label className="home-setting">
        <span>Folder</span>
        <input
          type="text"
          value={config.folder}
          placeholder="Whole vault"
          onChange={(e) => setConfig({ folder: e.target.value.trim() })}
        />
      </label>
      <label className="home-setting">
        <span>Tasks shown</span>
        <input
          type="number"
          min={1}
          max={50}
          value={config.count}
          onChange={(e) => setConfig({ count: Number(e.target.value) || 1 })}
        />
      </label>
      <label className="home-setting">
        <input
          type="checkbox"
          checked={config.showDone}
          onChange={(e) => setConfig({ showDone: e.target.checked })}
        />
        <span>Include finished tasks</span>
      </label>
    </>
  )
}

export const tasksWidget = defineWidget<TasksConfig>({
  type: 'tasks',
  name: 'Tasks',
  description: 'Open checkboxes from across the vault, tickable in place',
  icon: 'check',
  defaultSize: { w: 2, h: 3 },
  minSize: { w: 1, h: 2 },
  defaultConfig: { count: 12, folder: '', showDone: false },
  Component: Tasks,
  Settings: TasksSettings
})
