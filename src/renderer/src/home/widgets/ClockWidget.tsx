import { useEffect, useState } from 'react'
import { formatDate } from '@shared/template'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface ClockConfig extends Record<string, unknown> {
  showSeconds: boolean
  /** 24-hour time, rather than the 12-hour clock with an am/pm suffix. */
  military: boolean
}

function Clock({ config }: WidgetProps<ClockConfig>): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // A minute-resolution clock still ticks every second, or it shows the
    // wrong minute for up to a minute after the widget is added.
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const hours = config.military ? now.getHours() : now.getHours() % 12 || 12
  const time = `${String(hours).padStart(config.military ? 2 : 1, '0')}:${formatDate('mm', now)}${
    config.showSeconds ? `:${formatDate('ss', now)}` : ''
  }`

  return (
    <div className="home-clock">
      <div className="home-clock-time">
        {time}
        {config.military ? null : <span className="home-clock-suffix">{now.getHours() < 12 ? 'am' : 'pm'}</span>}
      </div>
      <div className="home-clock-date">{formatDate('DDDD, DD MMMM', now)}</div>
    </div>
  )
}

function ClockSettings({ config, setConfig }: WidgetSettingsProps<ClockConfig>): React.JSX.Element {
  return (
    <>
      <label className="home-setting">
        <input
          type="checkbox"
          checked={config.showSeconds}
          onChange={(e) => setConfig({ showSeconds: e.target.checked })}
        />
        <span>Show seconds</span>
      </label>
      <label className="home-setting">
        <input
          type="checkbox"
          checked={config.military}
          onChange={(e) => setConfig({ military: e.target.checked })}
        />
        <span>24-hour clock</span>
      </label>
    </>
  )
}

export const clockWidget = defineWidget<ClockConfig>({
  type: 'clock',
  name: 'Clock',
  description: 'The time and today’s date, from this machine',
  icon: 'clock',
  defaultSize: { w: 1, h: 1 },
  minSize: { w: 1, h: 1 },
  defaultConfig: { showSeconds: false, military: false },
  accent: 'quiet',
  Component: Clock,
  Settings: ClockSettings
})
