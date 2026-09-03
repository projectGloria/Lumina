import { useMemo } from 'react'
import { forgetConfigPath, rebaseConfigPath } from '@shared/homePaths'
import { isPathAtOrBelow } from '@shared/markdown-parse'
import { useVault } from '@/store/vaultStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface ProgressConfig extends Record<string, unknown> {
  /** Vault-relative folder to count within; empty means the whole vault. */
  folder: string
}

const RADIUS = 34
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Progress({ config }: WidgetProps<ProgressConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)

  const { done, total } = useMemo(() => {
    let done = 0
    let total = 0
    for (const note of Object.values(index.notes)) {
      if (config.folder && !isPathAtOrBelow(note.path, config.folder)) continue
      for (const task of note.tasks) {
        if (!task.text) continue
        total++
        if (task.done) done++
      }
    }
    return { done, total }
  }, [index, config.folder])

  const percent = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="home-progress">
      <svg className="home-progress-ring" viewBox="0 0 80 80" aria-hidden="true">
        <circle className="home-progress-track" cx="40" cy="40" r={RADIUS} />
        <circle
          className="home-progress-value"
          cx="40"
          cy="40"
          r={RADIUS}
          strokeDasharray={`${(percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        />
      </svg>
      <div className="home-progress-copy">
        <div className="home-progress-percent">{percent}%</div>
        <div className="home-progress-label">
          {total ? `${done} of ${total} done` : 'No tasks yet'}
        </div>
      </div>
    </div>
  )
}

function ProgressSettings({
  config,
  setConfig
}: WidgetSettingsProps<ProgressConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>Folder</span>
      <input
        type="text"
        value={config.folder}
        placeholder="Whole vault"
        onChange={(e) => setConfig({ folder: e.target.value.trim() })}
      />
    </label>
  )
}

export const progressWidget = defineWidget<ProgressConfig>({
  type: 'progress',
  name: 'Task progress',
  description: 'How much of your checkbox list is finished',
  icon: 'check',
  defaultSize: { w: 1, h: 2 },
  minSize: { w: 1, h: 1 },
  defaultConfig: { folder: '' },
  Component: Progress,
  Settings: ProgressSettings,
  rebasePaths: (config, from, to) => rebaseConfigPath(config, 'folder', from, to),
  // Given up rather than kept, for the reason the tasks card gives.
  forgetPaths: (config, deleted) => forgetConfigPath(config, 'folder', deleted, '')
})
