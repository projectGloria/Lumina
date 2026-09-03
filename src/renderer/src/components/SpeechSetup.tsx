/**
 * The one-time offer to set dictation up, shown on first run.
 *
 * Deliberately a dismissible modal rather than a step you have to get past:
 * Lumina is a note app, and someone who opened it to write a note should not
 * be made to answer a question about speech models first. It appears once,
 * only when this build actually carries packs and none are installed, and
 * never asks again whichever way it is answered.
 */
import { useEffect } from 'react'
import SpeechPacks from './settings/SpeechPacks'
import { Icon } from './Icon'
import { useSettings } from '../store/settingsStore'
import { useUi } from '../store/uiStore'

export default function SpeechSetup(): React.JSX.Element {
  const close = useUi((s) => s.closeModal)
  const patch = useSettings((s) => s.patch)

  /** Dismissing is an answer: it is recorded so the prompt does not return. */
  const done = (): void => {
    patch({ voice: { setupPrompted: true } })
    close()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `done` is stable enough here: both store functions are.
  }, [])

  return (
    <div className="overlay center" onMouseDown={done}>
      <div className="modal speech-setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Set up dictation</h2>
          <button className="icon-btn" onClick={done} data-tooltip="Close" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="speech-setup-body">
          <p className="voice-blurb">
            Lumina can turn speech into notes, and does it entirely on this
            machine — nothing you say is ever sent anywhere. The engine and the
            model are included in this copy, so installing them needs no
            internet connection.
          </p>
          <p className="voice-blurb">
            Pick a <strong>model</strong> and one <strong>engine</strong>. Take
            the GPU engine only if this machine has an NVIDIA card; on anything
            else it is a large download that will not be used.
          </p>

          <SpeechPacks />
        </div>

        <div className="speech-setup-footer">
          <button className="voice-btn" onClick={done}>
            Not now
          </button>
          <button className="voice-btn is-stop" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
