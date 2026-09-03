import { useState } from 'react'
import { oneOf } from '@shared/homeConfig'
import { Icon } from '@/components/Icon'
import { captureText } from '@/lib/actions'
import { toast } from '@/store/uiStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface CaptureConfig extends Record<string, unknown> {
  /** Where a captured line is filed: its own quick note, or today’s daily note. */
  target: 'quick' | 'daily'
}

function Capture({ config }: WidgetProps<CaptureConfig>): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Where a captured line is filed decides what the hint promises, so a word
  // this widget does not know must resolve once rather than per branch.
  const target = oneOf(config.target, ['quick', 'daily'] as const, 'quick')

  const submit = async (): Promise<void> => {
    if (!text.trim() || busy) return
    setBusy(true)
    const ok = await captureText(text, target)
    setBusy(false)
    if (!ok) return
    setText('')
    toast(target === 'daily' ? 'Added to today’s note' : 'Captured')
  }

  return (
    <div className="home-capture">
      <textarea
        className="home-capture-input"
        value={text}
        placeholder="Write it down, sort it out later…"
        aria-label="Quick capture"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter has to stay a newline — a capture box you cannot write two
          // lines in is worse than one extra keystroke to file it.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="home-capture-actions">
        <span className="home-capture-hint">
          {target === 'daily' ? 'Appends to today’s note' : 'Files a new quick note'}
        </span>
        <button
          className="btn btn-small btn-primary"
          disabled={!text.trim() || busy}
          onClick={() => void submit()}
        >
          <Icon name="check" size={14} />
          <span>Capture</span>
        </button>
      </div>
    </div>
  )
}

function CaptureSettings({
  config,
  setConfig
}: WidgetSettingsProps<CaptureConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>File into</span>
      <select
        value={oneOf(config.target, ['quick', 'daily'] as const, 'quick')}
        onChange={(e) => setConfig({ target: e.target.value as CaptureConfig['target'] })}
      >
        <option value="quick">A new quick note</option>
        <option value="daily">Today’s daily note</option>
      </select>
    </label>
  )
}

export const captureWidget = defineWidget<CaptureConfig>({
  type: 'capture',
  name: 'Quick capture',
  description: 'Write a thought straight into the vault without opening a note',
  icon: 'bolt',
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 2 },
  defaultConfig: { target: 'quick' },
  Component: Capture,
  Settings: CaptureSettings
})
