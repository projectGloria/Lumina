/**
 * Choosing a microphone, and proving it works before you rely on it.
 *
 * The dropdown and the meter are one component because they depend on each
 * other: device *names* are only readable once the page has been granted
 * microphone access, and the thing that asks for access is the meter. So the
 * list starts anonymous, and filling it in is a side effect of pressing Test.
 *
 * The meter reads the analyser on an animation frame and writes straight to the
 * DOM. Putting a level in React state would re-render the settings modal sixty
 * times a second for a bar that is a few pixels tall.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  hasMicrophoneAccess,
  listInputDevices,
  startLevelMonitor,
  type InputDevice,
  type LevelMonitor
} from '../../lib/recorder'
import { useSettings } from '../../store/settingsStore'
import { Icon } from '../Icon'

/** Segments in the meter. Enough to read at a glance, few enough to stay calm. */
const SEGMENTS = 24

/** Above this the input is close enough to clipping to be worth warning about. */
const HOT = 0.92

export default function MicTester(): React.JSX.Element {
  const deviceId = useSettings((s) => s.settings.voice.deviceId)
  const patch = useSettings((s) => s.patch)

  const [devices, setDevices] = useState<InputDevice[]>([])
  const [named, setNamed] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const monitor = useRef<LevelMonitor | null>(null)
  const meter = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  /** Highest level seen this run, so a short word still leaves a mark. */
  const peak = useRef(0)

  const refresh = useCallback(async () => {
    setDevices(await listInputDevices())
    setNamed(await hasMicrophoneAccess())
  }, [])

  useEffect(() => {
    void refresh()
    // Plugging a headset in while the panel is open should change the list.
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh)
  }, [refresh])

  const stop = useCallback(() => {
    monitor.current?.stop()
    monitor.current = null
    setTesting(false)

    // The loop writes to the DOM directly, so stopping it leaves the last
    // reading frozen on screen — which reads as "still listening".
    peak.current = 0
    const bars = meter.current?.children
    if (bars) {
      for (const bar of Array.from(bars)) bar.classList.remove('lit', 'peak')
    }
    if (readout.current) {
      readout.current.textContent = ''
      readout.current.className = 'mic-readout'
    }
  }, [])

  // Releasing the device on unmount is the important half: closing the settings
  // modal has to put the operating system's microphone indicator out.
  useEffect(() => stop, [stop])

  /** Open one device and start the loop. The only path that touches hardware. */
  const start = useCallback(
    async (id: string) => {
      setError(null)
      monitor.current?.stop()
      try {
        monitor.current = await startLevelMonitor(id)
        peak.current = 0
        setTesting(true)
        // Access has just been granted, so labels are readable now even if they
        // were not when the panel mounted.
        void refresh()
      } catch (err) {
        monitor.current = null
        setError((err as Error).message)
        setTesting(false)
      }
    },
    [refresh]
  )

  /* The meter loop. */
  useEffect(() => {
    if (!testing) return
    let frame = 0
    const tick = (): void => {
      const level = monitor.current?.level() ?? 0
      peak.current = Math.max(peak.current * 0.995, level)

      const bars = meter.current?.children
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const at = (i + 1) / bars.length
          const el = bars[i] as HTMLElement
          el.classList.toggle('lit', level >= at)
          el.classList.toggle('peak', peak.current >= at && peak.current < at + 1 / bars.length)
        }
      }
      if (readout.current) {
        readout.current.textContent =
          level < 0.02 ? 'silent' : level > HOT ? 'too loud' : `${Math.round(level * 100)}%`
        readout.current.className = `mic-readout${level > HOT ? ' is-hot' : ''}`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [testing])

  /**
   * Switching device mid-test reopens on the new one.
   *
   * `start` is passed the id directly rather than reading `deviceId` back out
   * of the store — the patch has not necessarily landed yet, and reopening the
   * device the user just switched away from is the one thing this must not do.
   */
  const choose = (id: string): void => {
    patch({ voice: { deviceId: id } })
    if (testing) void start(id)
  }

  return (
    <>
      <div className="field-row">
        <div>
          <div className="field-label">Microphone</div>
          <div className="field-hint">
            {named
              ? 'Used for voice notes and dictation.'
              : 'Start the test below to let Windows tell Lumina the device names.'}
          </div>
        </div>
        <div className="field-control">
          <select
            className="mic-select"
            value={deviceId}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row mic-test-row">
        <div>
          <div className="field-label">Test</div>
          <div className="field-hint">
            {testing ? 'Say something — the bar should move.' : 'Check the level before recording.'}
          </div>
        </div>
        <div className="field-control mic-test">
          <div className={`mic-meter${testing ? ' is-live' : ''}`} ref={meter} aria-hidden="true">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className={i > SEGMENTS * 0.85 ? 'hot' : i > SEGMENTS * 0.65 ? 'warm' : ''} />
            ))}
          </div>
          <span className="mic-readout" ref={readout}>
            {testing ? '…' : ''}
          </span>
          <button
            className={`voice-btn${testing ? ' is-stop' : ''}`}
            onClick={() => (testing ? stop() : void start(deviceId))}
            data-tooltip={testing ? 'Stop and release the microphone' : 'Open the microphone'}
          >
            <Icon name={testing ? 'stop' : 'mic'} size={13} />
            {testing ? 'Stop' : 'Test'}
          </button>
        </div>
      </div>

      {error ? <p className="mic-error">{error}</p> : null}
    </>
  )
}
