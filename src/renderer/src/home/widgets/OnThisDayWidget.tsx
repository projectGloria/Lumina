import { useMemo } from 'react'
import PathIcon from '@/components/PathIcon'
import { openNote } from '@/lib/actions'
import { useVault } from '@/store/vaultStore'
import { defineWidget } from './types'

/**
 * Notes written on this date in an earlier year.
 *
 * Matched on month and day rather than on a window around the date, because
 * the point is the anniversary — a note from two days ago is not "on this
 * day", and it is already in Recent notes.
 */
function OnThisDay(): React.JSX.Element {
  const index = useVault((s) => s.index)

  const notes = useMemo(() => {
    const today = new Date()
    return Object.values(index.notes)
      .filter((note) => {
        if (!note.createdAt) return false
        const created = new Date(note.createdAt)
        return (
          created.getFullYear() < today.getFullYear() &&
          created.getMonth() === today.getMonth() &&
          created.getDate() === today.getDate()
        )
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [index])

  if (!notes.length) {
    return <p className="home-widget-empty">Nothing from this day in earlier years.</p>
  }

  return (
    <ul className="home-list">
      {notes.map((note) => (
        <li key={note.path}>
          <button className="home-row" data-tooltip={note.path} onClick={() => openNote(note.path)}>
            <PathIcon path={note.path} size={15} className="home-row-icon" />
            <span className="home-row-label truncate">{note.title}</span>
            <span className="home-row-meta">{new Date(note.createdAt).getFullYear()}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export const onThisDayWidget = defineWidget<Record<string, unknown>>({
  type: 'onThisDay',
  name: 'On this day',
  description: 'Notes you wrote on this date in earlier years',
  icon: 'refresh',
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  defaultConfig: {},
  Component: OnThisDay
})
