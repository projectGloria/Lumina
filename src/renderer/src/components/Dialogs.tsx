import { useEffect, useRef, useState } from 'react'
import { useUi } from '../store/uiStore'

/**
 * A text prompt, used for naming and renaming.
 *
 * `onSubmit` may return an error string to keep the dialog open with the input
 * intact, so a name collision does not throw away what was typed.
 */
export function PromptDialog(): React.JSX.Element | null {
  const prompt = useUi((s) => s.prompt)
  const hide = useUi((s) => s.hidePrompt)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!prompt) return
    setValue(prompt.initial)
    setError('')
    setBusy(false)
    // Select the part worth replacing, leaving the extension alone.
    requestAnimationFrame(() => {
      const el = input.current
      if (!el) return
      el.focus()
      el.setSelectionRange(0, prompt.selectLength ?? prompt.initial.length)
    })
  }, [prompt])

  if (!prompt) return null

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await prompt.onSubmit(value)
      if (typeof result === 'string' && result) setError(result)
      else hide()
    } catch (err) {
      setError((err as Error).message || 'The operation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay center" onMouseDown={hide}>
      <div className="modal dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{prompt.title}</h3>
        <label className="dialog-body">
          {prompt.label ? <span className="dialog-label">{prompt.label}</span> : null}
          <input
            ref={input}
            type="text"
            value={value}
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                hide()
              }
            }}
          />
          {error ? <span className="dialog-error">{error}</span> : null}
        </label>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={hide}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {prompt.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmDialog(): React.JSX.Element | null {
  const confirm = useUi((s) => s.confirm)
  const hide = useUi((s) => s.hideConfirm)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirm) requestAnimationFrame(() => button.current?.focus())
  }, [confirm])

  if (!confirm) return null

  const accept = (): void => {
    confirm.onConfirm()
    hide()
  }

  return (
    <div className="overlay center" onMouseDown={hide}>
      <div
        className="modal dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide()
        }}
      >
        <h3 className="dialog-title">{confirm.title}</h3>
        {confirm.body ? <p className="dialog-body-text">{confirm.body}</p> : null}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={hide}>
            Cancel
          </button>
          <button
            ref={button}
            className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={accept}
          >
            {confirm.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
