import { useUi } from '../store/uiStore'

export default function Toasts(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.kind === 'error' ? ' error' : ''}`}
          style={{ pointerEvents: 'auto' }}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
          {t.repeats && t.repeats > 1 ? <span className="toast-count"> ×{t.repeats}</span> : null}
        </div>
      ))}
    </div>
  )
}
