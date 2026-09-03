import { useEffect, useMemo, useState } from 'react'
import { isPathAtOrBelow, setTaskDone, toPlainText } from '@shared/markdown-parse'
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

/** `path:line` — a task has no id of its own, and the pair is what identifies it. */
const keyOf = (path: string, line: number): string => `${path}:${line}`

function Tasks({ config }: WidgetProps<TasksConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)
  /**
   * Boxes ticked here but not yet seen coming back through the index.
   *
   * A write goes to disk, the watcher notices, and the note is reparsed — long
   * enough that a checkbox with no optimistic state looks broken when clicked.
   */
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const tasks = useMemo(() => {
    const rows = []
    for (const note of Object.values(index.notes)) {
      if (config.folder && !isPathAtOrBelow(note.path, config.folder)) continue
      for (const task of note.tasks) {
        if (!task.text) continue
        rows.push({ ...task, path: note.path, mtime: note.mtime })
      }
    }
    return rows
      .filter((task) => config.showDone || !(pending[keyOf(task.path, task.line)] ?? task.done))
      .sort((a, b) => b.mtime - a.mtime || a.line - b.line)
      .slice(0, Math.max(1, config.count))
  }, [index, config.folder, config.showDone, config.count, pending])

  // Drop an optimistic tick once the index agrees with it, so the row goes
  // back to reflecting the file rather than this widget's memory of it.
  useEffect(() => {
    setPending((current) => {
      const next: Record<string, boolean> = {}
      let settled = false
      for (const [key, value] of Object.entries(current)) {
        const split = key.lastIndexOf(':')
        const task = index.notes[key.slice(0, split)]?.tasks.find(
          (candidate) => candidate.line === Number(key.slice(split + 1))
        )
        if (task && task.done === value) settled = true
        else next[key] = value
      }
      return settled ? next : current
    })
  }, [index])

  const toggle = async (path: string, line: number, done: boolean): Promise<void> => {
    const key = keyOf(path, line)
    setPending((current) => ({ ...current, [key]: done }))

    let applied = false
    const ok = await updateNoteContent(path, (content) => {
      const next = setTaskDone(content, line, done)
      applied = next !== null
      return next ?? content
    })

    if (ok && applied) return
    setPending((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    // The index is a snapshot; the line may have moved since it was taken.
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
        const key = keyOf(task.path, task.line)
        const done = pending[key] ?? task.done
        return (
          <li key={key} className={`home-task${done ? ' is-done' : ''}`}>
            <input
              type="checkbox"
              className="home-task-box"
              checked={done}
              aria-label={task.text}
              onChange={(e) => void toggle(task.path, task.line, e.target.checked)}
            />
            <button
              className="home-task-text truncate"
              data-tooltip={`${task.path}:${task.line + 1}`}
              onClick={() => openNote(task.path, { line: task.line })}
            >
              {toPlainText(task.text)}
            </button>
            <span className="home-row-meta truncate">{titleOf(task.path)}</span>
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
