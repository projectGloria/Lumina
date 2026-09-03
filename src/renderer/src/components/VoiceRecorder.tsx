/**
 * The recording bar: elapsed time, a live level meter, stop and cancel.
 *
 * Driven by `uiStore.voice` and rendered by `App.tsx` above everything, so a
 * recording started from the palette stays visible while the user navigates.
 * The meter reads the analyser directly on an animation frame rather than
 * pushing levels through the store — sixty store writes a second would
 * re-render the workspace for a bar that is two pixels wide.
 */
import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '@shared/audio'
import { cancelVoice, inputLevel, stopVoice } from '../lib/voice'
import { useUi } from '../store/uiStore'
import { Icon } from './Icon'

const BARS = 13

export default function VoiceRecorder(): React.JSX.Element | null {
  const voice = useUi((s) => s.voice)
  const meter = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)

  const recording = voice?.phase === 'recording'

  /* The clock. On an interval rather than an animation frame, and running for
     every phase rather than only while recording: a hidden or occluded window
     stops delivering frames, and "Transcribing…" with a frozen count is what
     makes a working transcription look like a hung one. */
  useEffect(() => {
    if (!voice) return
    setElapsed((Date.now() - voice.startedAt) / 1000)
    const id = setInterval(() => setElapsed((Date.now() - voice.startedAt) / 1000), 200)
    return () => clearInterval(id)
  }, [voice])

  useEffect(() => {
    if (!recording || !voice) return
    let frame = 0
    const tick = (): void => {
      const level = inputLevel()
      const bars = meter.current?.children
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          // A fixed shape scaled by the live level, so the meter reads as one
          // waveform reacting rather than bars flickering independently.
          const shape = 0.35 + 0.65 * Math.sin(((i + 1) / (BARS + 1)) * Math.PI)
          const height = 3 + level * shape * 22
          ;(bars[i] as HTMLElement).style.height = `${height.toFixed(1)}px`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [recording, voice])

  // Escape abandons the recording, the same as the cancel button. Only while
  // actually recording — once whisper has the audio there is nothing to cancel.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelVoice()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  if (!voice) return null

  const busy = voice.phase === 'saving' || voice.phase === 'transcribing'
  // Busy phases carry the elapsed seconds too. Whisper can take several
  // seconds to answer, and a number that keeps moving is the difference
  // between "it is working" and "it has hung".
  const label =
    voice.phase === 'starting'
      ? 'Opening the microphone…'
      : voice.phase === 'saving'
        ? `Saving… ${elapsed.toFixed(0)}s`
        : voice.phase === 'transcribing'
          ? `Transcribing… ${elapsed.toFixed(0)}s`
          : formatDuration(elapsed)

  return (
    <div className="voice-bar" role="status" aria-live="polite">
      <span className={`voice-dot${recording ? ' is-live' : ''}`} aria-hidden="true" />
      <span className="voice-label">
        {voice.mode === 'dictate' ? 'Dictating' : 'Recording'}
      </span>

      {/* Live dictation writes as you speak, so the bar has to show that the
          words you just said are still on their way rather than lost. */}
      {voice.pending ? (
        <span className="voice-pending" title="Transcribing what you just said">
          <span className="voice-pending-dot" />
          {voice.pending > 1 ? `${voice.pending} phrases` : 'writing…'}
        </span>
      ) : null}

      {recording ? (
        <div className="voice-meter" ref={meter} aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      ) : null}

      <span className={`voice-time${busy ? ' is-busy' : ''}`}>{label}</span>

      {recording ? (
        <>
          <button className="voice-btn is-stop" onClick={() => void stopVoice()} data-tooltip="Finish recording">
            <Icon name="stop" size={14} />
            Done
          </button>
          <button className="voice-btn" onClick={cancelVoice} data-tooltip="Discard this recording (Esc)">
            Cancel
          </button>
        </>
      ) : null}
    </div>
  )
}
