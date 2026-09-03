/**
 * The read-aloud bar: what is being read, how far through it is, and the
 * controls for it.
 *
 * Drawn by `App.tsx` above everything and driven by `uiStore.speech`, the same
 * shape as `VoiceRecorder`, so a reading started from the palette stays
 * reachable while the user navigates away from the note it came from. It sits
 * above the recording bar when both are up rather than under it — the two are
 * independent, and dictating while listening is odd but not forbidden.
 */
import { useEffect } from 'react'
import { skipReading, stopReading, togglePauseReading } from '../lib/readAloud'
import { useUi } from '../store/uiStore'
import { Icon } from './Icon'

export default function SpeechPlayer(): React.JSX.Element | null {
  const speech = useUi((s) => s.speech)
  const recording = useUi((s) => s.voice !== null)

  // Escape stops, the way it cancels a recording. Captured, so it beats a
  // panel that would otherwise treat Escape as its own.
  useEffect(() => {
    if (!speech) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      stopReading()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [speech])

  if (!speech) return null

  const paused = speech.phase === 'paused'
  const progress = speech.total > 0 ? Math.min(speech.index / speech.total, 1) : 0

  return (
    <div className={`voice-bar speech-bar${recording ? ' is-stacked' : ''}`} role="status" aria-live="polite">
      <Icon name="speaker" size={15} />
      <span className="voice-label">{paused ? 'Paused' : 'Reading'}</span>
      <span className="speech-what" title={speech.label}>
        {speech.label}
      </span>

      {/* Utterances, not seconds: the synthesizer will not say how long it
          intends to take, and a bar that filled by guesswork would lie. */}
      <div
        className="speech-progress"
        role="progressbar"
        aria-valuenow={speech.index}
        aria-valuemin={0}
        aria-valuemax={speech.total}
        aria-label="Reading progress"
      >
        <span style={{ width: `${(progress * 100).toFixed(1)}%` }} />
      </div>
      <span className="voice-time">
        {Math.min(speech.index + 1, speech.total)} / {speech.total}
      </span>

      <button
        className="voice-btn is-icon"
        onClick={() => skipReading(-1)}
        data-tooltip="Previous sentence"
        aria-label="Previous sentence"
      >
        <Icon name="skipBack" size={13} />
      </button>
      <button
        className="voice-btn is-icon"
        onClick={togglePauseReading}
        data-tooltip={paused ? 'Resume' : 'Pause'}
        aria-label={paused ? 'Resume reading' : 'Pause reading'}
      >
        <Icon name={paused ? 'play' : 'pause'} size={13} />
      </button>
      <button
        className="voice-btn is-icon"
        onClick={() => skipReading(1)}
        data-tooltip="Next sentence"
        aria-label="Next sentence"
      >
        <Icon name="skipForward" size={13} />
      </button>
      <button className="voice-btn is-stop" onClick={stopReading} data-tooltip="Stop reading (Esc)">
        <Icon name="stop" size={13} />
        Stop
      </button>
    </div>
  )
}
